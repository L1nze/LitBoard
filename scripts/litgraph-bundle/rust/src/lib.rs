//! LitGraph：LitBoard 引文网络的 Rust 计算内核（力导向布局 + 社区划分 + PageRank）。
//!
//! 算法转录自 js/graphgen.js（Fruchterman-Reingold 布局 / CNM 贪心模块度 / Louvain 局部移动 /
//! 幂迭代 PageRank）。按约定走「各自确定性」：本模块对同一输入总是同一输出，但不承诺与
//! JS 回退路径逐位一致（JS 侧 Map 迭代序/浮点累加次序不复刻）。因此 Rust 侧一律用
//! BTreeMap / 索引数组保证自身迭代序稳定，任何新增的遍历都必须保持这一点。
//!
//! 经由 napi Task 在 libuv 线程池执行（compute() 在 worker 线程跑），返回 Promise——
//! 主进程（窗口消息泵）等待期间不会被同步计算堵住。

use std::collections::{BTreeMap, HashMap};

use napi::bindgen_prelude::*;
use napi::{Env, Task};

#[macro_use]
extern crate napi_derive;

/* ─────────────────── napi 输入输出 ─────────────────── */

#[napi(object)]
pub struct GraphEdge {
  pub from: String,
  pub to: String,
}

#[napi(object)]
pub struct ComputeOptions {
  /// 布局随机种子（JS 侧 LAYOUT.seed = 42）
  pub seed: Option<f64>,
  /// 布局迭代次数（缺省与 JS 同规则：n > 400 时 100，否则 200）
  pub iterations: Option<u32>,
}

#[napi(object)]
pub struct Position {
  pub id: String,
  pub x: f64,
  pub y: f64,
}

#[napi(object)]
pub struct GraphMetrics {
  pub layout: Vec<Position>,
  /// 与输入 ids 对齐的社区号（按社区规模降序编号，0 = 最大社区）
  pub communities: Vec<u32>,
  /// 与输入 ids 对齐的 PageRank
  pub pagerank: Vec<f64>,
}

pub struct ComputeTask {
  ids: Vec<String>,
  edges: Vec<(usize, usize)>,
  seed: u32,
  iterations: u32,
}

/// 计算引文网络指标。返回 Promise<GraphMetrics>；ids 去空去重保持顺序（对照 uniqueStrings）。
#[napi]
pub fn compute_graph_metrics(
  ids: Vec<String>,
  edges: Vec<GraphEdge>,
  opts: Option<ComputeOptions>,
) -> AsyncTask<ComputeTask> {
  let mut index: HashMap<String, usize> = HashMap::new();
  let mut unique: Vec<String> = Vec::with_capacity(ids.len());
  for id in ids {
    let id = id.trim().to_string();
    if id.is_empty() || index.contains_key(&id) {
      continue;
    }
    index.insert(id.clone(), unique.len());
    unique.push(id);
  }
  let pairs = edges
    .iter()
    .filter_map(|e| match (index.get(&e.from), index.get(&e.to)) {
      (Some(&a), Some(&b)) => Some((a, b)),
      _ => None,
    })
    .collect();
  let n = unique.len();
  let iterations = opts
    .as_ref()
    .and_then(|o| o.iterations)
    .filter(|&it| it > 0)
    .unwrap_or(if n > 400 { 100 } else { 200 });
  let seed = opts
    .as_ref()
    .and_then(|o| o.seed)
    .map(|s| s as u32)
    .unwrap_or(42);
  AsyncTask::new(ComputeTask { ids: unique, edges: pairs, seed, iterations })
}

impl Task for ComputeTask {
  type Output = GraphMetrics;
  type JsValue = GraphMetrics;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(compute_all(&self.ids, &self.edges, self.seed, self.iterations))
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<GraphMetrics> {
    Ok(output)
  }
}

fn compute_all(ids: &[String], edges: &[(usize, usize)], seed: u32, iterations: u32) -> GraphMetrics {
  let pagerank = page_rank(ids.len(), edges, 0.85, 20);
  let communities = detect_communities(ids.len(), edges);
  let layout = compute_layout(ids, edges, seed, iterations);
  GraphMetrics { layout, communities, pagerank }
}

/* ─────────────────── mulberry32（转录 seededRandom） ─────────────────── */

struct Rng(u32);

impl Rng {
  fn new(seed: u32) -> Rng {
    Rng(if seed == 0 { 1 } else { seed }) // JS: (Number(seed) >>> 0) || 1
  }

  fn next_f64(&mut self) -> f64 {
    self.0 = self.0.wrapping_add(0x6D2B79F5);
    let mut t = self.0;
    t = (t ^ (t >> 15)).wrapping_mul(t | 1);
    t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
    ((t ^ (t >> 14)) as f64) / 4294967296.0
  }
}

/* ─────────────────── PageRank（转录 graphgen.pageRank） ─────────────────── */

fn page_rank(n: usize, edges: &[(usize, usize)], damping: f64, iterations: u32) -> Vec<f64> {
  if n == 0 {
    return Vec::new();
  }
  let mut ranks = vec![1.0 / n as f64; n];
  let mut out_count = vec![0usize; n];
  for &(from, _) in edges {
    out_count[from] += 1;
  }
  for _ in 0..iterations.max(1) {
    let mut next = vec![(1.0 - damping) / n as f64; n];
    for &(from, to) in edges {
      let out = if out_count[from] == 0 { 1 } else { out_count[from] };
      next[to] += damping * ranks[from] / out as f64;
    }
    // 悬挂节点（不出边）把份额均分
    for id in 0..n {
      if out_count[id] == 0 {
        let share = damping * ranks[id] / n as f64;
        for other in next.iter_mut() {
          *other += share;
        }
      }
    }
    ranks = next;
  }
  ranks
}

/* ─────────────────── 社区划分（转录 detectCommunities） ─────────────────── */

const COMMUNITY_LIMIT_NODES: usize = 500;
const COMMUNITY_LIMIT_EDGES: usize = 10000;

/// 无向邻接（权重 = 边数；自环权重 2、计 m2 += 2，对照 undirectedAdjacency）。
/// 邻居表用 BTreeMap：迭代序确定 → CNM/Louvain 的平局裁决可复现。
fn undirected_adjacency(n: usize, edges: &[(usize, usize)]) -> (Vec<BTreeMap<usize, f64>>, f64) {
  let mut adj: Vec<BTreeMap<usize, f64>> = vec![BTreeMap::new(); n];
  let mut m2 = 0.0f64;
  for &(from, to) in edges {
    if from >= n || to >= n {
      continue;
    }
    if from == to {
      *adj[from].entry(from).or_insert(0.0) += 2.0;
      m2 += 2.0;
      continue;
    }
    *adj[from].entry(to).or_insert(0.0) += 1.0;
    *adj[to].entry(from).or_insert(0.0) += 1.0;
    m2 += 2.0;
  }
  (adj, m2)
}

fn detect_communities(n: usize, edges: &[(usize, usize)]) -> Vec<u32> {
  if n == 0 {
    return Vec::new();
  }
  let (adj, m2) = undirected_adjacency(n, edges);
  let groups: Vec<Vec<usize>> = if m2 == 0.0 {
    (0..n).map(|id| vec![id]).collect()
  } else if n > COMMUNITY_LIMIT_NODES || edges.len() > COMMUNITY_LIMIT_EDGES {
    louvain_groups(n, &adj, m2)
  } else {
    greedy_modularity_groups(n, edges, &adj, m2)
  };
  // 社区号按规模降序（0 = 最大）；并列按最小成员 id 升序（对照 detectCommunities 的排序）
  let mut sorted: Vec<Vec<usize>> = groups;
  sorted.sort_by(|a, b| {
    b.len()
      .cmp(&a.len())
      .then_with(|| a.iter().min().cmp(&b.iter().min()))
  });
  let mut label = vec![0u32; n];
  for (index, group) in sorted.iter().enumerate() {
    for &id in group {
      label[id] = index as u32;
    }
  }
  label
}

/// CNM 贪心模块度：每轮并入 ΔQ 最大且为正的一对社区（对照 greedyModularityGroups）。
fn greedy_modularity_groups(
  n: usize,
  edges: &[(usize, usize)],
  adj: &[BTreeMap<usize, f64>],
  m2: f64,
) -> Vec<Vec<usize>> {
  let m = m2 / 2.0;
  let mut comm: Vec<usize> = (0..n).collect();
  let mut members: BTreeMap<usize, Vec<usize>> = (0..n).map(|id| (id, vec![id])).collect();
  let mut cdeg: BTreeMap<usize, f64> = (0..n)
    .map(|id| (id, adj[id].values().sum::<f64>()))
    .collect();
  let mut links: BTreeMap<(usize, usize), f64> = BTreeMap::new();
  for &(from, to) in edges {
    if from == to {
      continue;
    }
    let key = if from < to { (from, to) } else { (to, from) };
    *links.entry(key).or_insert(0.0) += 1.0;
  }
  let delta = |links: &BTreeMap<(usize, usize), f64>,
               cdeg: &BTreeMap<usize, f64>,
               a: usize,
               b: usize|
               -> f64 {
    let weight = links
      .get(&(if a < b { (a, b) } else { (b, a) }))
      .copied()
      .unwrap_or(0.0);
    weight / m - cdeg.get(&a).copied().unwrap_or(0.0) * cdeg.get(&b).copied().unwrap_or(0.0) / (2.0 * m * m)
  };
  for _ in 0..n {
    let mut best: Option<(usize, usize, f64)> = None;
    for (&(a, b), _) in links.iter() {
      if a == b {
        continue;
      }
      let score = delta(&links, &cdeg, a, b);
      if best.is_none() || score > best.unwrap().2 {
        best = Some((a, b, score));
      }
    }
    let (a, b, score) = match best {
      Some(v) => v,
      None => break,
    };
    if score <= 0.0 {
      break;
    }
    // 小社区并入大社区（并列保持 a，对照 mergeCommunities 的 >= 裁决）
    let (keep, drop) = if members.get(&a).map(|v| v.len()).unwrap_or(0)
      >= members.get(&b).map(|v| v.len()).unwrap_or(0)
    {
      (a, b)
    } else {
      (b, a)
    };
    if let Some(dropped) = members.remove(&drop) {
      for &id in &dropped {
        comm[id] = keep;
      }
      members.entry(keep).or_default().extend(dropped);
    }
    let dropped_deg = cdeg.remove(&drop).unwrap_or(0.0);
    *cdeg.entry(keep).or_insert(0.0) += dropped_deg;
    let moved: Vec<(usize, f64)> = links
      .iter()
      .filter_map(|(&(x, y), &w)| {
        if x != drop && y != drop {
          return None;
        }
        Some((if x == drop { y } else { x }, w))
      })
      .collect();
    for (other, weight) in moved {
      let key = if drop < other { (drop, other) } else { (other, drop) };
      links.remove(&key);
      if keep != other {
        let key = if keep < other { (keep, other) } else { (other, keep) };
        *links.entry(key).or_insert(0.0) += weight;
      }
    }
  }
  // comm[] 记录每个节点最终所属的社区代表；按代表分组即社区（组内保持 id 序）
  let mut by_rep: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
  for (id, &rep) in comm.iter().enumerate() {
    by_rep.entry(rep).or_default().push(id);
  }
  by_rep.into_values().collect()
}

/// Louvain 局部移动（大图启发式；对照 louvainGroups，种子同样取 42）。
fn louvain_groups(n: usize, adj: &[BTreeMap<usize, f64>], m2: f64) -> Vec<Vec<usize>> {
  let mut rand = Rng::new(42);
  let degree: Vec<f64> = adj.iter().map(|m| m.values().sum::<f64>()).collect();
  let mut comm: Vec<usize> = (0..n).collect();
  let mut cdeg: BTreeMap<usize, f64> = (0..n).map(|id| (id, degree[id])).collect();
  let mut order: Vec<usize> = (0..n).collect();
  for i in (1..n).rev() {
    let j = (rand.next_f64() * (i as f64 + 1.0)).floor() as usize;
    order.swap(i, j.min(i));
  }
  for _ in 0..20 {
    let mut moved = false;
    for &id in &order {
      let own = comm[id];
      let k = degree[id];
      let mut weights: BTreeMap<usize, f64> = BTreeMap::new();
      for (&nb, &weight) in &adj[id] {
        if nb == id {
          continue;
        }
        *weights.entry(comm[nb]).or_insert(0.0) += weight;
      }
      *cdeg.entry(own).or_insert(0.0) -= k;
      let mut best_comm = own;
      let own_link = weights.get(&own).copied().unwrap_or(0.0);
      let mut best_gain = own_link - k * cdeg.get(&own).copied().unwrap_or(0.0) / m2;
      for (&c, &weight) in &weights {
        let gain = weight - k * cdeg.get(&c).copied().unwrap_or(0.0) / m2;
        if gain > best_gain + 1e-12 {
          best_gain = gain;
          best_comm = c;
        }
      }
      *cdeg.entry(best_comm).or_insert(0.0) += k;
      if best_comm != own {
        comm[id] = best_comm;
        moved = true;
      }
    }
    if !moved {
      break;
    }
  }
  let mut by_comm: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
  for (id, &c) in comm.iter().enumerate() {
    by_comm.entry(c).or_default().push(id);
  }
  by_comm.into_values().collect()
}

/* ─────────────────── 布局（转录 computeLayout） ─────────────────── */

const LAYOUT_K: f64 = 2.0;
const LAYOUT_PIXEL: f64 = 90.0;

/// JS Math.round = floor(x + 0.5)（含负数语义）；Rust f64::round 是四舍五入远离零，二者不同。
fn js_round(x: f64) -> f64 {
  (x + 0.5).floor()
}

fn compute_layout(ids: &[String], edges: &[(usize, usize)], seed: u32, iterations: u32) -> Vec<Position> {
  let n = ids.len();
  if n == 0 {
    return Vec::new();
  }
  if n == 1 {
    return vec![Position { id: ids[0].clone(), x: 0.0, y: 0.0 }];
  }
  let (adjacency, _) = undirected_adjacency(n, edges);
  let mut rand = Rng::new(seed);
  let mut pos: Vec<(f64, f64)> = (0..n).map(|_| (rand.next_f64(), rand.next_f64())).collect();
  let k = LAYOUT_K / (n as f64).sqrt();
  let mut temperature = 0.1f64;
  for _ in 0..iterations {
    let mut disp = vec![(0.0f64, 0.0f64); n];
    // 斥力：全对 O(n²)
    for i in 0..n {
      for j in (i + 1)..n {
        let dx = pos[i].0 - pos[j].0;
        let dy = pos[i].1 - pos[j].1;
        let mut dist = (dx * dx + dy * dy).sqrt();
        if dist == 0.0 {
          dist = 0.01;
        }
        let force = (k * k) / dist;
        let ux = dx / dist;
        let uy = dy / dist;
        disp[i].0 += ux * force;
        disp[i].1 += uy * force;
        disp[j].0 -= ux * force;
        disp[j].1 -= uy * force;
      }
    }
    // 弹簧力：无向边只算一次（nb < id 跳过，对照原实现）
    for id in 0..n {
      for (&nb, _) in &adjacency[id] {
        if nb <= id {
          continue;
        }
        let dx = pos[id].0 - pos[nb].0;
        let dy = pos[id].1 - pos[nb].1;
        let mut dist = (dx * dx + dy * dy).sqrt();
        if dist == 0.0 {
          dist = 0.01;
        }
        let force = (dist * dist) / k;
        let ux = dx / dist;
        let uy = dy / dist;
        disp[id].0 -= ux * force;
        disp[id].1 -= uy * force;
        disp[nb].0 += ux * force;
        disp[nb].1 += uy * force;
      }
    }
    // 温度限步
    for id in 0..n {
      let (dx, dy) = disp[id];
      let mut len = (dx * dx + dy * dy).sqrt();
      if len == 0.0 {
        len = 0.01;
      }
      let step = len.min(temperature) / len;
      pos[id].0 += dx * step;
      pos[id].1 += dy * step;
    }
    temperature = (temperature * 0.99).max(0.001);
  }
  // 复位到原点并缩放到 [-1,1]
  let cx = pos.iter().map(|p| p.0).sum::<f64>() / n as f64;
  let cy = pos.iter().map(|p| p.1).sum::<f64>() / n as f64;
  let mut max_abs = 0.0f64;
  for p in pos.iter_mut() {
    p.0 -= cx;
    p.1 -= cy;
    max_abs = max_abs.max(p.0.abs()).max(p.1.abs());
  }
  if max_abs > 0.0 {
    for p in pos.iter_mut() {
      p.0 /= max_abs;
      p.1 /= max_abs;
    }
  }
  // 度数（无向，自环不计，对照 degreeMaps）
  let mut degree = vec![0i64; n];
  for &(from, to) in edges {
    if from == to || from >= n || to >= n {
      continue;
    }
    degree[from] += 1;
    degree[to] += 1;
  }
  arrange_components(&mut pos, &components(n, &adjacency));
  compact_peripheral(&mut pos, &degree);
  // 单位空间 ×(90·√n) 转像素；坐标四舍五入到 0.1
  let factor = LAYOUT_PIXEL * (n as f64).sqrt();
  ids.iter()
    .enumerate()
    .map(|(i, id)| Position {
      id: id.clone(),
      x: js_round(pos[i].0 * factor * 10.0) / 10.0,
      y: js_round(pos[i].1 * factor * 10.0) / 10.0,
    })
    .collect()
}

/// 弱连通分量（栈式 DFS，对照 components）
fn components(n: usize, adj: &[BTreeMap<usize, f64>]) -> Vec<Vec<usize>> {
  let mut seen = vec![false; n];
  let mut out = Vec::new();
  for start in 0..n {
    if seen[start] {
      continue;
    }
    seen[start] = true;
    let mut stack = vec![start];
    let mut group = Vec::new();
    while let Some(id) = stack.pop() {
      group.push(id);
      for (&nb, _) in adj[id].iter().rev() {
        // .rev() 对齐 JS Map 的插入序弹出习惯；组内顺序只影响后续均值求和次序
        if !seen[nb] {
          seen[nb] = true;
          stack.push(nb);
        }
      }
    }
    out.push(group);
  }
  out
}

/// 孤立/稀疏分量贴到主分量外环（对照 arrangeComponents）
fn arrange_components(pos: &mut [(f64, f64)], groups: &[Vec<usize>]) {
  let mut sorted: Vec<&Vec<usize>> = groups.iter().collect();
  sorted.sort_by(|a, b| {
    b.len()
      .cmp(&a.len())
      .then_with(|| a.iter().min().cmp(&b.iter().min()))
  });
  if sorted.len() <= 1 {
    return;
  }
  let main = sorted[0];
  let (mut cx, mut cy) = (0.0, 0.0);
  for &id in main {
    cx += pos[id].0;
    cy += pos[id].1;
  }
  cx /= main.len() as f64;
  cy /= main.len() as f64;
  for p in pos.iter_mut() {
    p.0 -= cx;
    p.1 -= cy;
  }
  let mut main_radius = 0.35f64;
  for &id in main {
    main_radius = main_radius.max(pos[id].0.hypot(pos[id].1));
  }
  let ring_radius = 0.88f64.min(0.58f64.max(main_radius + 0.22));
  let peripheral = &sorted[1..];
  let step = 2.0 * std::f64::consts::PI / peripheral.len().max(1) as f64;
  for (index, group) in peripheral.iter().enumerate() {
    let angle = -std::f64::consts::PI / 7.0 + index as f64 * step;
    let target_radius = 0.92f64.min(ring_radius + 0.04 * (index % 2) as f64);
    let (mut gx, mut gy) = (0.0, 0.0);
    for &id in group.iter() {
      gx += pos[id].0;
      gy += pos[id].1;
    }
    gx /= group.len() as f64;
    gy /= group.len() as f64;
    let dx = angle.cos() * target_radius - gx;
    let dy = angle.sin() * target_radius - gy;
    for &id in group.iter() {
      pos[id].0 += dx;
      pos[id].1 += dy;
    }
  }
}

/// 极弱连接节点不许飘太远（对照 compactPeripheral）
fn compact_peripheral(pos: &mut [(f64, f64)], degree: &[i64]) {
  let max_radius = 0.96f64;
  let isolate_radius = 0.72f64;
  for (id, p) in pos.iter_mut().enumerate() {
    let radius = p.0.hypot(p.1);
    let mut target = radius;
    if radius > 0.0 {
      let deg = degree.get(id).copied().unwrap_or(0);
      if deg == 0 {
        target = max_radius.min(isolate_radius.max(radius));
      } else if deg == 1 && radius > max_radius {
        target = max_radius;
      }
    }
    let scale = if target == radius || radius == 0.0 { 1.0 } else { target / radius };
    p.0 *= scale;
    p.1 *= scale;
  }
}

/* ─────────────────── 单元测试（cargo test；自身确定性） ─────────────────── */

#[cfg(test)]
fn ba_graph(n: usize, m: usize, seed: u32) -> (Vec<String>, Vec<GraphEdge>) {
  let mut rand = Rng::new(seed);
  let mut ids = Vec::new();
  let mut edges = Vec::new();
  let mut degree = vec![0usize; n];
  let mut total = 0usize;
  for v in 0..n {
    ids.push(format!("W{}", v));
    if v == 0 {
      continue;
    }
    let k = m.min(v);
    let mut targets: Vec<usize> = Vec::new();
    while targets.len() < k {
      let mut r = rand.next_f64() * (total + v) as f64;
      let mut picked = v - 1;
      for u in 0..v {
        let weight = (degree[u] + 1) as f64;
        if r <= weight {
          picked = u;
          break;
        }
        r -= weight;
      }
      if !targets.contains(&picked) {
        targets.push(picked);
      }
    }
    for u in targets {
      edges.push(GraphEdge { from: ids[v].clone(), to: ids[u].clone() });
      degree[v] += 1;
      degree[u] += 1;
      total += 2;
    }
  }
  (ids, edges)
}

#[cfg(test)]
fn encode(ids: &[String], edges: &[GraphEdge]) -> Vec<(usize, usize)> {
  let index: HashMap<&str, usize> = ids.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
  edges
    .iter()
    .filter_map(|e| Some((*index.get(e.from.as_str())?, *index.get(e.to.as_str())?)))
    .collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn pagerank_sums_to_one() {
    let (ids, edges) = ba_graph(60, 3, 7);
    let pairs = encode(&ids, &edges);
    let ranks = page_rank(ids.len(), &pairs, 0.85, 20);
    let sum: f64 = ranks.iter().sum();
    assert!((sum - 1.0).abs() < 1e-9, "sum = {}", sum);
    assert!(ranks.iter().all(|r| r.is_finite() && *r > 0.0));
  }

  #[test]
  fn communities_labeled_by_size_desc() {
    let (ids, edges) = ba_graph(80, 3, 11);
    let labels = detect_communities(ids.len(), &encode(&ids, &edges));
    let mut sizes: BTreeMap<u32, usize> = BTreeMap::new();
    for &l in &labels {
      *sizes.entry(l).or_insert(0) += 1;
    }
    let keys: Vec<u32> = sizes.keys().copied().collect();
    assert_eq!(keys.first().copied(), Some(0), "社区号必须从 0 开始");
    assert!(
      keys.windows(2).all(|w| w[0] + 1 == w[1]),
      "社区号必须连续：{:?}",
      keys
    );
    let counts: Vec<usize> = keys.iter().map(|k| sizes[k]).collect();
    assert!(
      counts.windows(2).all(|w| w[0] >= w[1]),
      "社区按规模降序：{:?}",
      counts
    );
  }

  #[test]
  fn layout_finite_and_deterministic() {
    let (ids, edges) = ba_graph(120, 3, 42);
    let pairs = encode(&ids, &edges);
    let a = compute_all(&ids, &pairs, 42, 200);
    let b = compute_all(&ids, &pairs, 42, 200);
    assert_eq!(a.layout.len(), ids.len());
    for p in &a.layout {
      assert!(p.x.is_finite() && p.y.is_finite());
    }
    let same = a
      .layout
      .iter()
      .zip(b.layout.iter())
      .all(|(x, y)| x.id == y.id && x.x == y.x && x.y == y.y)
      && a.communities == b.communities
      && a.pagerank == b.pagerank;
    assert!(same, "同输入必须同输出（各自确定性）");
  }

  #[test]
  fn empty_and_singleton() {
    assert!(compute_all(&[], &[], 42, 200).layout.is_empty());
    let one = compute_all(&["W0".to_string()], &[], 42, 200);
    assert_eq!(one.layout.len(), 1);
    assert_eq!(one.layout[0].x, 0.0);
    assert_eq!(one.communities, vec![0]);
  }

  #[test]
  fn no_edge_graph_all_singletons() {
    let _ids: Vec<String> = (0..5).map(|i| format!("W{}", i)).collect();
    let labels = detect_communities(5, &[]);
    assert_eq!(labels, vec![0, 1, 2, 3, 4]);
  }
}
