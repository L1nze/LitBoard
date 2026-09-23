var LitPaddleOcrBundle=(()=>{var x_=Object.create;var ls=Object.defineProperty;var $_=Object.getOwnPropertyDescriptor;var C_=Object.getOwnPropertyNames;var I_=Object.getPrototypeOf,T_=Object.prototype.hasOwnProperty;var Ui=(e=>typeof require<"u"?require:typeof Proxy<"u"?new Proxy(e,{get:(t,r)=>(typeof require<"u"?require:t)[r]}):e)(function(e){if(typeof require<"u")return require.apply(this,arguments);throw Error('Dynamic require of "'+e+'" is not supported')});var S_=(e,t)=>()=>(e&&(t=e(e=0)),t);var P_=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),E_=(e,t)=>{for(var r in t)ls(e,r,{get:t[r],enumerable:!0})},A_=(e,t,r,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let s of C_(t))!T_.call(e,s)&&s!==r&&ls(e,s,{get:()=>t[s],enumerable:!(n=$_(t,s))||n.enumerable});return e};var O_=(e,t,r)=>(r=e!=null?x_(I_(e)):{},A_(t||!e||!e.__esModule?ls(r,"default",{value:e,enumerable:!0}):r,e));var Gu=P_((cx,un)=>{(function(){"use strict";var e={};e.version="6.4.2.2",e.use_lines=!0,e.use_xyz=!1;var t=!1;typeof un<"u"&&un.exports?(un.exports=e,t=!0):(typeof define=="function"&&define.amd&&define(e),typeof document<"u"?window.ClipperLib=e:self.ClipperLib=e);var r;if(t){var n="chrome";r="Netscape"}else{var n=navigator.userAgent.toString().toLowerCase();r=navigator.appName}var s={};n.indexOf("chrome")!=-1&&n.indexOf("chromium")==-1?s.chrome=1:s.chrome=0,n.indexOf("chromium")!=-1?s.chromium=1:s.chromium=0,n.indexOf("safari")!=-1&&n.indexOf("chrome")==-1&&n.indexOf("chromium")==-1?s.safari=1:s.safari=0,n.indexOf("firefox")!=-1?s.firefox=1:s.firefox=0,n.indexOf("firefox/17")!=-1?s.firefox17=1:s.firefox17=0,n.indexOf("firefox/15")!=-1?s.firefox15=1:s.firefox15=0,n.indexOf("firefox/3")!=-1?s.firefox3=1:s.firefox3=0,n.indexOf("opera")!=-1?s.opera=1:s.opera=0,n.indexOf("msie 10")!=-1?s.msie10=1:s.msie10=0,n.indexOf("msie 9")!=-1?s.msie9=1:s.msie9=0,n.indexOf("msie 8")!=-1?s.msie8=1:s.msie8=0,n.indexOf("msie 7")!=-1?s.msie7=1:s.msie7=0,n.indexOf("msie ")!=-1?s.msie=1:s.msie=0,e.biginteger_used=null;var l,a=0xdeadbeefcafe,d=(a&16777215)==15715070;function p(i,o,u){e.biginteger_used=1,i!=null&&(typeof i=="number"&&typeof o>"u"?this.fromInt(i):typeof i=="number"?this.fromNumber(i,o,u):o==null&&typeof i!="string"?this.fromString(i,256):this.fromString(i,o))}function c(){return new p(null,void 0,void 0)}function g(i,o,u,h,v,I){for(;--I>=0;){var A=o*this[i++]+u[h]+v;v=Math.floor(A/67108864),u[h++]=A&67108863}return v}function _(i,o,u,h,v,I){for(var A=o&32767,D=o>>15;--I>=0;){var z=this[i]&32767,H=this[i++]>>15,ae=D*z+H*A;z=A*z+((ae&32767)<<15)+u[h]+(v&1073741823),v=(z>>>30)+(ae>>>15)+D*H+(v>>>30),u[h++]=z&1073741823}return v}function w(i,o,u,h,v,I){for(var A=o&16383,D=o>>14;--I>=0;){var z=this[i]&16383,H=this[i++]>>14,ae=D*z+H*A;z=A*z+((ae&16383)<<14)+u[h]+v,v=(z>>28)+(ae>>14)+D*H,u[h++]=z&268435455}return v}d&&r=="Microsoft Internet Explorer"?(p.prototype.am=_,l=30):d&&r!="Netscape"?(p.prototype.am=g,l=26):(p.prototype.am=w,l=28),p.prototype.DB=l,p.prototype.DM=(1<<l)-1,p.prototype.DV=1<<l;var C=52;p.prototype.FV=Math.pow(2,C),p.prototype.F1=C-l,p.prototype.F2=2*l-C;var x="0123456789abcdefghijklmnopqrstuvwxyz",S=new Array,N,E;for(N=48,E=0;E<=9;++E)S[N++]=E;for(N=97,E=10;E<36;++E)S[N++]=E;for(N=65,E=10;E<36;++E)S[N++]=E;function T(i){return x.charAt(i)}function B(i,o){var u=S[i.charCodeAt(o)];return u??-1}function L(i){for(var o=this.t-1;o>=0;--o)i[o]=this[o];i.t=this.t,i.s=this.s}function M(i){this.t=1,this.s=i<0?-1:0,i>0?this[0]=i:i<-1?this[0]=i+this.DV:this.t=0}function F(i){var o=c();return o.fromInt(i),o}function U(i,o){var u;if(o==16)u=4;else if(o==8)u=3;else if(o==256)u=8;else if(o==2)u=1;else if(o==32)u=5;else if(o==4)u=2;else{this.fromRadix(i,o);return}this.t=0,this.s=0;for(var h=i.length,v=!1,I=0;--h>=0;){var A=u==8?i[h]&255:B(i,h);if(A<0){i.charAt(h)=="-"&&(v=!0);continue}v=!1,I==0?this[this.t++]=A:I+u>this.DB?(this[this.t-1]|=(A&(1<<this.DB-I)-1)<<I,this[this.t++]=A>>this.DB-I):this[this.t-1]|=A<<I,I+=u,I>=this.DB&&(I-=this.DB)}u==8&&(i[0]&128)!=0&&(this.s=-1,I>0&&(this[this.t-1]|=(1<<this.DB-I)-1<<I)),this.clamp(),v&&p.ZERO.subTo(this,this)}function k(){for(var i=this.s&this.DM;this.t>0&&this[this.t-1]==i;)--this.t}function re(i){if(this.s<0)return"-"+this.negate().toString(i);var o;if(i==16)o=4;else if(i==8)o=3;else if(i==2)o=1;else if(i==32)o=5;else if(i==4)o=2;else return this.toRadix(i);var u=(1<<o)-1,h,v=!1,I="",A=this.t,D=this.DB-A*this.DB%o;if(A-- >0)for(D<this.DB&&(h=this[A]>>D)>0&&(v=!0,I=T(h));A>=0;)D<o?(h=(this[A]&(1<<D)-1)<<o-D,h|=this[--A]>>(D+=this.DB-o)):(h=this[A]>>(D-=o)&u,D<=0&&(D+=this.DB,--A)),h>0&&(v=!0),v&&(I+=T(h));return v?I:"0"}function oe(){var i=c();return p.ZERO.subTo(this,i),i}function ye(){return this.s<0?this.negate():this}function fe(i){var o=this.s-i.s;if(o!=0)return o;var u=this.t;if(o=u-i.t,o!=0)return this.s<0?-o:o;for(;--u>=0;)if((o=this[u]-i[u])!=0)return o;return 0}function ce(i){var o=1,u;return(u=i>>>16)!=0&&(i=u,o+=16),(u=i>>8)!=0&&(i=u,o+=8),(u=i>>4)!=0&&(i=u,o+=4),(u=i>>2)!=0&&(i=u,o+=2),(u=i>>1)!=0&&(i=u,o+=1),o}function $e(){return this.t<=0?0:this.DB*(this.t-1)+ce(this[this.t-1]^this.s&this.DM)}function q(i,o){var u;for(u=this.t-1;u>=0;--u)o[u+i]=this[u];for(u=i-1;u>=0;--u)o[u]=0;o.t=this.t+i,o.s=this.s}function Y(i,o){for(var u=i;u<this.t;++u)o[u-i]=this[u];o.t=Math.max(this.t-i,0),o.s=this.s}function Ie(i,o){var u=i%this.DB,h=this.DB-u,v=(1<<h)-1,I=Math.floor(i/this.DB),A=this.s<<u&this.DM,D;for(D=this.t-1;D>=0;--D)o[D+I+1]=this[D]>>h|A,A=(this[D]&v)<<u;for(D=I-1;D>=0;--D)o[D]=0;o[I]=A,o.t=this.t+I+1,o.s=this.s,o.clamp()}function Te(i,o){o.s=this.s;var u=Math.floor(i/this.DB);if(u>=this.t){o.t=0;return}var h=i%this.DB,v=this.DB-h,I=(1<<h)-1;o[0]=this[u]>>h;for(var A=u+1;A<this.t;++A)o[A-u-1]|=(this[A]&I)<<v,o[A-u]=this[A]>>h;h>0&&(o[this.t-u-1]|=(this.s&I)<<v),o.t=this.t-u,o.clamp()}function be(i,o){for(var u=0,h=0,v=Math.min(i.t,this.t);u<v;)h+=this[u]-i[u],o[u++]=h&this.DM,h>>=this.DB;if(i.t<this.t){for(h-=i.s;u<this.t;)h+=this[u],o[u++]=h&this.DM,h>>=this.DB;h+=this.s}else{for(h+=this.s;u<i.t;)h-=i[u],o[u++]=h&this.DM,h>>=this.DB;h-=i.s}o.s=h<0?-1:0,h<-1?o[u++]=this.DV+h:h>0&&(o[u++]=h),o.t=u,o.clamp()}function ke(i,o){var u=this.abs(),h=i.abs(),v=u.t;for(o.t=v+h.t;--v>=0;)o[v]=0;for(v=0;v<h.t;++v)o[v+u.t]=u.am(0,h[v],o,v,0,u.t);o.s=0,o.clamp(),this.s!=i.s&&p.ZERO.subTo(o,o)}function ne(i){for(var o=this.abs(),u=i.t=2*o.t;--u>=0;)i[u]=0;for(u=0;u<o.t-1;++u){var h=o.am(u,o[u],i,2*u,0,1);(i[u+o.t]+=o.am(u+1,2*o[u],i,2*u+1,h,o.t-u-1))>=o.DV&&(i[u+o.t]-=o.DV,i[u+o.t+1]=1)}i.t>0&&(i[i.t-1]+=o.am(u,o[u],i,2*u,0,1)),i.s=0,i.clamp()}function Se(i,o,u){var h=i.abs();if(!(h.t<=0)){var v=this.abs();if(v.t<h.t){o?.fromInt(0),u!=null&&this.copyTo(u);return}u==null&&(u=c());var I=c(),A=this.s,D=i.s,z=this.DB-ce(h[h.t-1]);z>0?(h.lShiftTo(z,I),v.lShiftTo(z,u)):(h.copyTo(I),v.copyTo(u));var H=I.t,ae=I[H-1];if(ae!=0){var te=ae*(1<<this.F1)+(H>1?I[H-2]>>this.F2:0),ge=this.FV/te,Ne=(1<<this.F1)/te,Xe=1<<this.F2,He=u.t,rt=He-H,wt=o??c();for(I.dlShiftTo(rt,wt),u.compareTo(wt)>=0&&(u[u.t++]=1,u.subTo(wt,u)),p.ONE.dlShiftTo(H,wt),wt.subTo(I,I);I.t<H;)I[I.t++]=0;for(;--rt>=0;){var $t=u[--He]==ae?this.DM:Math.floor(u[He]*ge+(u[He-1]+Xe)*Ne);if((u[He]+=I.am(0,$t,u,rt,0,H))<$t)for(I.dlShiftTo(rt,wt),u.subTo(wt,u);u[He]<--$t;)u.subTo(wt,u)}o!=null&&(u.drShiftTo(H,o),A!=D&&p.ZERO.subTo(o,o)),u.t=H,u.clamp(),z>0&&u.rShiftTo(z,u),A<0&&p.ZERO.subTo(u,u)}}}function ve(i){var o=c();return this.abs().divRemTo(i,null,o),this.s<0&&o.compareTo(p.ZERO)>0&&i.subTo(o,o),o}function me(i){this.m=i}function Ue(i){return i.s<0||i.compareTo(this.m)>=0?i.mod(this.m):i}function st(i){return i}function et(i){i.divRemTo(this.m,null,i)}function it(i,o,u){i.multiplyTo(o,u),this.reduce(u)}function Ge(i,o){i.squareTo(o),this.reduce(o)}me.prototype.convert=Ue,me.prototype.revert=st,me.prototype.reduce=et,me.prototype.mulTo=it,me.prototype.sqrTo=Ge;function Be(){if(this.t<1)return 0;var i=this[0];if((i&1)==0)return 0;var o=i&3;return o=o*(2-(i&15)*o)&15,o=o*(2-(i&255)*o)&255,o=o*(2-((i&65535)*o&65535))&65535,o=o*(2-i*o%this.DV)%this.DV,o>0?this.DV-o:-o}function Je(i){this.m=i,this.mp=i.invDigit(),this.mpl=this.mp&32767,this.mph=this.mp>>15,this.um=(1<<i.DB-15)-1,this.mt2=2*i.t}function _t(i){var o=c();return i.abs().dlShiftTo(this.m.t,o),o.divRemTo(this.m,null,o),i.s<0&&o.compareTo(p.ZERO)>0&&this.m.subTo(o,o),o}function Xt(i){var o=c();return i.copyTo(o),this.reduce(o),o}function vt(i){for(;i.t<=this.mt2;)i[i.t++]=0;for(var o=0;o<this.m.t;++o){var u=i[o]&32767,h=u*this.mpl+((u*this.mph+(i[o]>>15)*this.mpl&this.um)<<15)&i.DM;for(u=o+this.m.t,i[u]+=this.m.am(0,h,i,o,0,this.m.t);i[u]>=i.DV;)i[u]-=i.DV,i[++u]++}i.clamp(),i.drShiftTo(this.m.t,i),i.compareTo(this.m)>=0&&i.subTo(this.m,i)}function Qe(i,o){i.squareTo(o),this.reduce(o)}function ri(i,o,u){i.multiplyTo(o,u),this.reduce(u)}Je.prototype.convert=_t,Je.prototype.revert=Xt,Je.prototype.reduce=vt,Je.prototype.mulTo=ri,Je.prototype.sqrTo=Qe;function Et(){return(this.t>0?this[0]&1:this.s)==0}function ni(i,o){if(i>4294967295||i<1)return p.ONE;var u=c(),h=c(),v=o.convert(this),I=ce(i)-1;for(v.copyTo(u);--I>=0;)if(o.sqrTo(u,h),(i&1<<I)>0)o.mulTo(h,v,u);else{var A=u;u=h,h=A}return o.revert(u)}function xt(i,o){var u;return i<256||o.isEven()?u=new me(o):u=new Je(o),this.exp(i,u)}p.prototype.copyTo=L,p.prototype.fromInt=M,p.prototype.fromString=U,p.prototype.clamp=k,p.prototype.dlShiftTo=q,p.prototype.drShiftTo=Y,p.prototype.lShiftTo=Ie,p.prototype.rShiftTo=Te,p.prototype.subTo=be,p.prototype.multiplyTo=ke,p.prototype.squareTo=ne,p.prototype.divRemTo=Se,p.prototype.invDigit=Be,p.prototype.isEven=Et,p.prototype.exp=ni,p.prototype.toString=re,p.prototype.negate=oe,p.prototype.abs=ye,p.prototype.compareTo=fe,p.prototype.bitLength=$e,p.prototype.mod=ve,p.prototype.modPowInt=xt,p.ZERO=F(0),p.ONE=F(1);function zt(){var i=c();return this.copyTo(i),i}function pi(){if(this.s<0){if(this.t==1)return this[0]-this.DV;if(this.t==0)return-1}else{if(this.t==1)return this[0];if(this.t==0)return 0}return(this[1]&(1<<32-this.DB)-1)<<this.DB|this[0]}function At(){return this.t==0?this.s:this[0]<<24>>24}function ci(){return this.t==0?this.s:this[0]<<16>>16}function Ot(i){return Math.floor(Math.LN2*this.DB/Math.log(i))}function xi(){return this.s<0?-1:this.t<=0||this.t==1&&this[0]<=0?0:1}function si(i){if(i==null&&(i=10),this.signum()==0||i<2||i>36)return"0";var o=this.chunkSize(i),u=Math.pow(i,o),h=F(u),v=c(),I=c(),A="";for(this.divRemTo(h,v,I);v.signum()>0;)A=(u+I.intValue()).toString(i).substr(1)+A,v.divRemTo(h,v,I);return I.intValue().toString(i)+A}function Tt(i,o){this.fromInt(0),o==null&&(o=10);for(var u=this.chunkSize(o),h=Math.pow(o,u),v=!1,I=0,A=0,D=0;D<i.length;++D){var z=B(i,D);if(z<0){i.charAt(D)=="-"&&this.signum()==0&&(v=!0);continue}A=o*A+z,++I>=u&&(this.dMultiply(h),this.dAddOffset(A,0),I=0,A=0)}I>0&&(this.dMultiply(Math.pow(o,I)),this.dAddOffset(A,0)),v&&p.ZERO.subTo(this,this)}function Di(i,o,u){if(typeof o=="number")if(i<2)this.fromInt(1);else for(this.fromNumber(i,u),this.testBit(i-1)||this.bitwiseTo(p.ONE.shiftLeft(i-1),j,this),this.isEven()&&this.dAddOffset(1,0);!this.isProbablePrime(o);)this.dAddOffset(2,0),this.bitLength()>i&&this.subTo(p.ONE.shiftLeft(i-1),this);else{var h=new Array,v=i&7;h.length=(i>>3)+1,o.nextBytes(h),v>0?h[0]&=(1<<v)-1:h[0]=0,this.fromString(h,256)}}function m(){var i=this.t,o=new Array;o[0]=this.s;var u=this.DB-i*this.DB%8,h,v=0;if(i-- >0)for(u<this.DB&&(h=this[i]>>u)!=(this.s&this.DM)>>u&&(o[v++]=h|this.s<<this.DB-u);i>=0;)u<8?(h=(this[i]&(1<<u)-1)<<8-u,h|=this[--i]>>(u+=this.DB-8)):(h=this[i]>>(u-=8)&255,u<=0&&(u+=this.DB,--i)),(h&128)!=0&&(h|=-256),v==0&&(this.s&128)!=(h&128)&&++v,(v>0||h!=this.s)&&(o[v++]=h);return o}function W(i){return this.compareTo(i)==0}function ie(i){return this.compareTo(i)<0?this:i}function ee(i){return this.compareTo(i)>0?this:i}function K(i,o,u){var h,v,I=Math.min(i.t,this.t);for(h=0;h<I;++h)u[h]=o(this[h],i[h]);if(i.t<this.t){for(v=i.s&this.DM,h=I;h<this.t;++h)u[h]=o(this[h],v);u.t=this.t}else{for(v=this.s&this.DM,h=I;h<i.t;++h)u[h]=o(v,i[h]);u.t=i.t}u.s=o(this.s,i.s),u.clamp()}function P(i,o){return i&o}function G(i){var o=c();return this.bitwiseTo(i,P,o),o}function j(i,o){return i|o}function se(i){var o=c();return this.bitwiseTo(i,j,o),o}function le(i,o){return i^o}function ue(i){var o=c();return this.bitwiseTo(i,le,o),o}function Q(i,o){return i&~o}function pe(i){var o=c();return this.bitwiseTo(i,Q,o),o}function xe(){for(var i=c(),o=0;o<this.t;++o)i[o]=this.DM&~this[o];return i.t=this.t,i.s=~this.s,i}function Ee(i){var o=c();return i<0?this.rShiftTo(-i,o):this.lShiftTo(i,o),o}function Ae(i){var o=c();return i<0?this.lShiftTo(-i,o):this.rShiftTo(i,o),o}function Le(i){if(i==0)return-1;var o=0;return(i&65535)==0&&(i>>=16,o+=16),(i&255)==0&&(i>>=8,o+=8),(i&15)==0&&(i>>=4,o+=4),(i&3)==0&&(i>>=2,o+=2),(i&1)==0&&++o,o}function ze(){for(var i=0;i<this.t;++i)if(this[i]!=0)return i*this.DB+Le(this[i]);return this.s<0?this.t*this.DB:-1}function kt(i){for(var o=0;i!=0;)i&=i-1,++o;return o}function oi(){for(var i=0,o=this.s&this.DM,u=0;u<this.t;++u)i+=kt(this[u]^o);return i}function ai(i){var o=Math.floor(i/this.DB);return o>=this.t?this.s!=0:(this[o]&1<<i%this.DB)!=0}function pt(i,o){var u=p.ONE.shiftLeft(i);return this.bitwiseTo(u,o,u),u}function zr(i){return this.changeBit(i,j)}function Fr(i){return this.changeBit(i,Q)}function Ur(i){return this.changeBit(i,le)}function qr(i,o){for(var u=0,h=0,v=Math.min(i.t,this.t);u<v;)h+=this[u]+i[u],o[u++]=h&this.DM,h>>=this.DB;if(i.t<this.t){for(h+=i.s;u<this.t;)h+=this[u],o[u++]=h&this.DM,h>>=this.DB;h+=this.s}else{for(h+=this.s;u<i.t;)h+=i[u],o[u++]=h&this.DM,h>>=this.DB;h+=i.s}o.s=h<0?-1:0,h>0?o[u++]=h:h<-1&&(o[u++]=this.DV+h),o.t=u,o.clamp()}function Wr(i){var o=c();return this.addTo(i,o),o}function Xr(i){var o=c();return this.subTo(i,o),o}function Yr(i){var o=c();return this.multiplyTo(i,o),o}function Gr(){var i=c();return this.squareTo(i),i}function Hr(i){var o=c();return this.divRemTo(i,o,null),o}function Vr(i){var o=c();return this.divRemTo(i,null,o),o}function jr(i){var o=c(),u=c();return this.divRemTo(i,o,u),new Array(o,u)}function Kr(i){this[this.t]=this.am(0,i-1,this,0,0,this.t),++this.t,this.clamp()}function Zr(i,o){if(i!=0){for(;this.t<=o;)this[this.t++]=0;for(this[o]+=i;this[o]>=this.DV;)this[o]-=this.DV,++o>=this.t&&(this[this.t++]=0),++this[o]}}function zi(){}function Nt(i){return i}function dr(i,o,u){i.multiplyTo(o,u)}function pr(i,o){i.squareTo(o)}zi.prototype.convert=Nt,zi.prototype.revert=Nt,zi.prototype.mulTo=dr,zi.prototype.sqrTo=pr;function zn(i){return this.exp(i,new zi)}function $i(i,o,u){var h=Math.min(this.t+i.t,o);for(u.s=0,u.t=h;h>0;)u[--h]=0;var v;for(v=u.t-this.t;h<v;++h)u[h+this.t]=this.am(0,i[h],u,h,0,this.t);for(v=Math.min(i.t,o);h<v;++h)this.am(0,i[h],u,h,0,o-h);u.clamp()}function Yt(i,o,u){--o;var h=u.t=this.t+i.t-o;for(u.s=0;--h>=0;)u[h]=0;for(h=Math.max(o-this.t,0);h<i.t;++h)u[this.t+h-o]=this.am(o-h,i[h],u,0,0,this.t+h-o);u.clamp(),u.drShiftTo(1,u)}function fi(i){this.r2=c(),this.q3=c(),p.ONE.dlShiftTo(2*i.t,this.r2),this.mu=this.r2.divide(i),this.m=i}function Fn(i){if(i.s<0||i.t>2*this.m.t)return i.mod(this.m);if(i.compareTo(this.m)<0)return i;var o=c();return i.copyTo(o),this.reduce(o),o}function Un(i){return i}function Jr(i){for(i.drShiftTo(this.m.t-1,this.r2),i.t>this.m.t+1&&(i.t=this.m.t+1,i.clamp()),this.mu.multiplyUpperTo(this.r2,this.m.t+1,this.q3),this.m.multiplyLowerTo(this.q3,this.m.t+1,this.r2);i.compareTo(this.r2)<0;)i.dAddOffset(1,this.m.t+1);for(i.subTo(this.r2,i);i.compareTo(this.m)>=0;)i.subTo(this.m,i)}function hi(i,o){i.squareTo(o),this.reduce(o)}function cr(i,o,u){i.multiplyTo(o,u),this.reduce(u)}fi.prototype.convert=Fn,fi.prototype.revert=Un,fi.prototype.reduce=Jr,fi.prototype.mulTo=cr,fi.prototype.sqrTo=hi;function St(i,o){var u=i.bitLength(),h,v=F(1),I;if(u<=0)return v;u<18?h=1:u<48?h=3:u<144?h=4:u<768?h=5:h=6,u<8?I=new me(o):o.isEven()?I=new fi(o):I=new Je(o);var A=new Array,D=3,z=h-1,H=(1<<h)-1;if(A[1]=I.convert(this),h>1){var ae=c();for(I.sqrTo(A[1],ae);D<=H;)A[D]=c(),I.mulTo(ae,A[D-2],A[D]),D+=2}var te=i.t-1,ge,Ne=!0,Xe=c(),He;for(u=ce(i[te])-1;te>=0;){for(u>=z?ge=i[te]>>u-z&H:(ge=(i[te]&(1<<u+1)-1)<<z-u,te>0&&(ge|=i[te-1]>>this.DB+u-z)),D=h;(ge&1)==0;)ge>>=1,--D;if((u-=D)<0&&(u+=this.DB,--te),Ne)A[ge].copyTo(v),Ne=!1;else{for(;D>1;)I.sqrTo(v,Xe),I.sqrTo(Xe,v),D-=2;D>0?I.sqrTo(v,Xe):(He=v,v=Xe,Xe=He),I.mulTo(Xe,A[ge],v)}for(;te>=0&&(i[te]&1<<u)==0;)I.sqrTo(v,Xe),He=v,v=Xe,Xe=He,--u<0&&(u=this.DB-1,--te)}return I.revert(v)}function Bt(i){var o=this.s<0?this.negate():this.clone(),u=i.s<0?i.negate():i.clone();if(o.compareTo(u)<0){var h=o;o=u,u=h}var v=o.getLowestSetBit(),I=u.getLowestSetBit();if(I<0)return o;for(v<I&&(I=v),I>0&&(o.rShiftTo(I,o),u.rShiftTo(I,u));o.signum()>0;)(v=o.getLowestSetBit())>0&&o.rShiftTo(v,o),(v=u.getLowestSetBit())>0&&u.rShiftTo(v,u),o.compareTo(u)>=0?(o.subTo(u,o),o.rShiftTo(1,o)):(u.subTo(o,u),u.rShiftTo(1,u));return I>0&&u.lShiftTo(I,u),u}function fr(i){if(i<=0)return 0;var o=this.DV%i,u=this.s<0?i-1:0;if(this.t>0)if(o==0)u=this[0]%i;else for(var h=this.t-1;h>=0;--h)u=(o*u+this[h])%i;return u}function qn(i){var o=i.isEven();if(this.isEven()&&o||i.signum()==0)return p.ZERO;for(var u=i.clone(),h=this.clone(),v=F(1),I=F(0),A=F(0),D=F(1);u.signum()!=0;){for(;u.isEven();)u.rShiftTo(1,u),o?((!v.isEven()||!I.isEven())&&(v.addTo(this,v),I.subTo(i,I)),v.rShiftTo(1,v)):I.isEven()||I.subTo(i,I),I.rShiftTo(1,I);for(;h.isEven();)h.rShiftTo(1,h),o?((!A.isEven()||!D.isEven())&&(A.addTo(this,A),D.subTo(i,D)),A.rShiftTo(1,A)):D.isEven()||D.subTo(i,D),D.rShiftTo(1,D);u.compareTo(h)>=0?(u.subTo(h,u),o&&v.subTo(A,v),I.subTo(D,I)):(h.subTo(u,h),o&&A.subTo(v,A),D.subTo(I,D))}if(h.compareTo(p.ONE)!=0)return p.ZERO;if(D.compareTo(i)>=0)return D.subtract(i);if(D.signum()<0)D.addTo(i,D);else return D;return D.signum()<0?D.add(i):D}var yt=[2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97,101,103,107,109,113,127,131,137,139,149,151,157,163,167,173,179,181,191,193,197,199,211,223,227,229,233,239,241,251,257,263,269,271,277,281,283,293,307,311,313,317,331,337,347,349,353,359,367,373,379,383,389,397,401,409,419,421,431,433,439,443,449,457,461,463,467,479,487,491,499,503,509,521,523,541,547,557,563,569,571,577,587,593,599,601,607,613,617,619,631,641,643,647,653,659,661,673,677,683,691,701,709,719,727,733,739,743,751,757,761,769,773,787,797,809,811,821,823,827,829,839,853,857,859,863,877,881,883,887,907,911,919,929,937,941,947,953,967,971,977,983,991,997],Wn=(1<<26)/yt[yt.length-1];function Xn(i){var o,u=this.abs();if(u.t==1&&u[0]<=yt[yt.length-1]){for(o=0;o<yt.length;++o)if(u[0]==yt[o])return!0;return!1}if(u.isEven())return!1;for(o=1;o<yt.length;){for(var h=yt[o],v=o+1;v<yt.length&&h<Wn;)h*=yt[v++];for(h=u.modInt(h);o<v;)if(h%yt[o++]==0)return!1}return u.millerRabin(i)}function Yn(i){var o=this.subtract(p.ONE),u=o.getLowestSetBit();if(u<=0)return!1;var h=o.shiftRight(u);i=i+1>>1,i>yt.length&&(i=yt.length);for(var v=c(),I=0;I<i;++I){v.fromInt(yt[Math.floor(Math.random()*yt.length)]);var A=v.modPow(h,this);if(A.compareTo(p.ONE)!=0&&A.compareTo(o)!=0){for(var D=1;D++<u&&A.compareTo(o)!=0;)if(A=A.modPowInt(2,this),A.compareTo(p.ONE)==0)return!1;if(A.compareTo(o)!=0)return!1}}return!0}p.prototype.chunkSize=Ot,p.prototype.toRadix=si,p.prototype.fromRadix=Tt,p.prototype.fromNumber=Di,p.prototype.bitwiseTo=K,p.prototype.changeBit=pt,p.prototype.addTo=qr,p.prototype.dMultiply=Kr,p.prototype.dAddOffset=Zr,p.prototype.multiplyLowerTo=$i,p.prototype.multiplyUpperTo=Yt,p.prototype.modInt=fr,p.prototype.millerRabin=Yn,p.prototype.clone=zt,p.prototype.intValue=pi,p.prototype.byteValue=At,p.prototype.shortValue=ci,p.prototype.signum=xi,p.prototype.toByteArray=m,p.prototype.equals=W,p.prototype.min=ie,p.prototype.max=ee,p.prototype.and=G,p.prototype.or=se,p.prototype.xor=ue,p.prototype.andNot=pe,p.prototype.not=xe,p.prototype.shiftLeft=Ee,p.prototype.shiftRight=Ae,p.prototype.getLowestSetBit=ze,p.prototype.bitCount=oi,p.prototype.testBit=ai,p.prototype.setBit=zr,p.prototype.clearBit=Fr,p.prototype.flipBit=Ur,p.prototype.add=Wr,p.prototype.subtract=Xr,p.prototype.multiply=Yr,p.prototype.divide=Hr,p.prototype.remainder=Vr,p.prototype.divideAndRemainder=jr,p.prototype.modPow=St,p.prototype.modInverse=qn,p.prototype.pow=zn,p.prototype.gcd=Bt,p.prototype.isProbablePrime=Xn,p.prototype.square=Gr;var We=p;We.prototype.IsNegative=function(){return this.compareTo(We.ZERO)==-1},We.op_Equality=function(i,o){return i.compareTo(o)==0},We.op_Inequality=function(i,o){return i.compareTo(o)!=0},We.op_GreaterThan=function(i,o){return i.compareTo(o)>0},We.op_LessThan=function(i,o){return i.compareTo(o)<0},We.op_Addition=function(i,o){return new We(i,void 0,void 0).add(new We(o,void 0,void 0))},We.op_Subtraction=function(i,o){return new We(i,void 0,void 0).subtract(new We(o,void 0,void 0))},We.Int128Mul=function(i,o){return new We(i,void 0,void 0).multiply(new We(o,void 0,void 0))},We.op_Division=function(i,o){return i.divide(o)},We.prototype.ToDouble=function(){return parseFloat(this.toString())};var Gt=function(i,o){var u;if(typeof Object.getOwnPropertyNames>"u"){for(u in o.prototype)(typeof i.prototype[u]>"u"||i.prototype[u]===Object.prototype[u])&&(i.prototype[u]=o.prototype[u]);for(u in o)typeof i[u]>"u"&&(i[u]=o[u]);i.$baseCtor=o}else{for(var h=Object.getOwnPropertyNames(o.prototype),v=0;v<h.length;v++)typeof Object.getOwnPropertyDescriptor(i.prototype,h[v])>"u"&&Object.defineProperty(i.prototype,h[v],Object.getOwnPropertyDescriptor(o.prototype,h[v]));for(u in o)typeof i[u]>"u"&&(i[u]=o[u]);i.$baseCtor=o}};e.Path=function(){return[]},e.Path.prototype.push=Array.prototype.push,e.Paths=function(){return[]},e.Paths.prototype.push=Array.prototype.push,e.DoublePoint=function(){var i=arguments;this.X=0,this.Y=0,i.length===1?(this.X=i[0].X,this.Y=i[0].Y):i.length===2&&(this.X=i[0],this.Y=i[1])},e.DoublePoint0=function(){this.X=0,this.Y=0},e.DoublePoint0.prototype=e.DoublePoint.prototype,e.DoublePoint1=function(i){this.X=i.X,this.Y=i.Y},e.DoublePoint1.prototype=e.DoublePoint.prototype,e.DoublePoint2=function(i,o){this.X=i,this.Y=o},e.DoublePoint2.prototype=e.DoublePoint.prototype,e.PolyNode=function(){this.m_Parent=null,this.m_polygon=new e.Path,this.m_Index=0,this.m_jointype=0,this.m_endtype=0,this.m_Childs=[],this.IsOpen=!1},e.PolyNode.prototype.IsHoleNode=function(){for(var i=!0,o=this.m_Parent;o!==null;)i=!i,o=o.m_Parent;return i},e.PolyNode.prototype.ChildCount=function(){return this.m_Childs.length},e.PolyNode.prototype.Contour=function(){return this.m_polygon},e.PolyNode.prototype.AddChild=function(i){var o=this.m_Childs.length;this.m_Childs.push(i),i.m_Parent=this,i.m_Index=o},e.PolyNode.prototype.GetNext=function(){return this.m_Childs.length>0?this.m_Childs[0]:this.GetNextSiblingUp()},e.PolyNode.prototype.GetNextSiblingUp=function(){return this.m_Parent===null?null:this.m_Index===this.m_Parent.m_Childs.length-1?this.m_Parent.GetNextSiblingUp():this.m_Parent.m_Childs[this.m_Index+1]},e.PolyNode.prototype.Childs=function(){return this.m_Childs},e.PolyNode.prototype.Parent=function(){return this.m_Parent},e.PolyNode.prototype.IsHole=function(){return this.IsHoleNode()},e.PolyTree=function(){this.m_AllPolys=[],e.PolyNode.call(this)},e.PolyTree.prototype.Clear=function(){for(var i=0,o=this.m_AllPolys.length;i<o;i++)this.m_AllPolys[i]=null;this.m_AllPolys.length=0,this.m_Childs.length=0},e.PolyTree.prototype.GetFirst=function(){return this.m_Childs.length>0?this.m_Childs[0]:null},e.PolyTree.prototype.Total=function(){var i=this.m_AllPolys.length;return i>0&&this.m_Childs[0]!==this.m_AllPolys[0]&&i--,i},Gt(e.PolyTree,e.PolyNode),e.Math_Abs_Int64=e.Math_Abs_Int32=e.Math_Abs_Double=function(i){return Math.abs(i)},e.Math_Max_Int32_Int32=function(i,o){return Math.max(i,o)},s.msie||s.opera||s.safari?e.Cast_Int32=function(i){return i|0}:e.Cast_Int32=function(i){return~~i},typeof Number.toInteger>"u"&&(Number.toInteger=null),s.chrome?e.Cast_Int64=function(i){return i<-2147483648||i>2147483647?i<0?Math.ceil(i):Math.floor(i):~~i}:s.firefox&&typeof Number.toInteger=="function"?e.Cast_Int64=function(i){return Number.toInteger(i)}:s.msie7||s.msie8?e.Cast_Int64=function(i){return parseInt(i,10)}:s.msie?e.Cast_Int64=function(i){return i<-2147483648||i>2147483647?i<0?Math.ceil(i):Math.floor(i):i|0}:e.Cast_Int64=function(i){return i<0?Math.ceil(i):Math.floor(i)},e.Clear=function(i){i.length=0},e.PI=3.141592653589793,e.PI2=2*3.141592653589793,e.IntPoint=function(){var i=arguments,o=i.length;if(this.X=0,this.Y=0,e.use_xyz)if(this.Z=0,o===3)this.X=i[0],this.Y=i[1],this.Z=i[2];else if(o===2)this.X=i[0],this.Y=i[1],this.Z=0;else if(o===1)if(i[0]instanceof e.DoublePoint){var u=i[0];this.X=e.Clipper.Round(u.X),this.Y=e.Clipper.Round(u.Y),this.Z=0}else{var h=i[0];typeof h.Z>"u"&&(h.Z=0),this.X=h.X,this.Y=h.Y,this.Z=h.Z}else this.X=0,this.Y=0,this.Z=0;else if(o===2)this.X=i[0],this.Y=i[1];else if(o===1)if(i[0]instanceof e.DoublePoint){var u=i[0];this.X=e.Clipper.Round(u.X),this.Y=e.Clipper.Round(u.Y)}else{var h=i[0];this.X=h.X,this.Y=h.Y}else this.X=0,this.Y=0},e.IntPoint.op_Equality=function(i,o){return i.X===o.X&&i.Y===o.Y},e.IntPoint.op_Inequality=function(i,o){return i.X!==o.X||i.Y!==o.Y},e.IntPoint0=function(){this.X=0,this.Y=0,e.use_xyz&&(this.Z=0)},e.IntPoint0.prototype=e.IntPoint.prototype,e.IntPoint1=function(i){this.X=i.X,this.Y=i.Y,e.use_xyz&&(typeof i.Z>"u"?this.Z=0:this.Z=i.Z)},e.IntPoint1.prototype=e.IntPoint.prototype,e.IntPoint1dp=function(i){this.X=e.Clipper.Round(i.X),this.Y=e.Clipper.Round(i.Y),e.use_xyz&&(this.Z=0)},e.IntPoint1dp.prototype=e.IntPoint.prototype,e.IntPoint2=function(i,o,u){this.X=i,this.Y=o,e.use_xyz&&(typeof u>"u"?this.Z=0:this.Z=u)},e.IntPoint2.prototype=e.IntPoint.prototype,e.IntRect=function(){var i=arguments,o=i.length;if(o===4)this.left=i[0],this.top=i[1],this.right=i[2],this.bottom=i[3];else if(o===1){var u=i[0];this.left=u.left,this.top=u.top,this.right=u.right,this.bottom=u.bottom}else this.left=0,this.top=0,this.right=0,this.bottom=0},e.IntRect0=function(){this.left=0,this.top=0,this.right=0,this.bottom=0},e.IntRect0.prototype=e.IntRect.prototype,e.IntRect1=function(i){this.left=i.left,this.top=i.top,this.right=i.right,this.bottom=i.bottom},e.IntRect1.prototype=e.IntRect.prototype,e.IntRect4=function(i,o,u,h){this.left=i,this.top=o,this.right=u,this.bottom=h},e.IntRect4.prototype=e.IntRect.prototype,e.ClipType={ctIntersection:0,ctUnion:1,ctDifference:2,ctXor:3},e.PolyType={ptSubject:0,ptClip:1},e.PolyFillType={pftEvenOdd:0,pftNonZero:1,pftPositive:2,pftNegative:3},e.JoinType={jtSquare:0,jtRound:1,jtMiter:2},e.EndType={etOpenSquare:0,etOpenRound:1,etOpenButt:2,etClosedLine:3,etClosedPolygon:4},e.EdgeSide={esLeft:0,esRight:1},e.Direction={dRightToLeft:0,dLeftToRight:1},e.TEdge=function(){this.Bot=new e.IntPoint0,this.Curr=new e.IntPoint0,this.Top=new e.IntPoint0,this.Delta=new e.IntPoint0,this.Dx=0,this.PolyTyp=e.PolyType.ptSubject,this.Side=e.EdgeSide.esLeft,this.WindDelta=0,this.WindCnt=0,this.WindCnt2=0,this.OutIdx=0,this.Next=null,this.Prev=null,this.NextInLML=null,this.NextInAEL=null,this.PrevInAEL=null,this.NextInSEL=null,this.PrevInSEL=null},e.IntersectNode=function(){this.Edge1=null,this.Edge2=null,this.Pt=new e.IntPoint0},e.MyIntersectNodeSort=function(){},e.MyIntersectNodeSort.Compare=function(i,o){var u=o.Pt.Y-i.Pt.Y;return u>0?1:u<0?-1:0},e.LocalMinima=function(){this.Y=0,this.LeftBound=null,this.RightBound=null,this.Next=null},e.Scanbeam=function(){this.Y=0,this.Next=null},e.Maxima=function(){this.X=0,this.Next=null,this.Prev=null},e.OutRec=function(){this.Idx=0,this.IsHole=!1,this.IsOpen=!1,this.FirstLeft=null,this.Pts=null,this.BottomPt=null,this.PolyNode=null},e.OutPt=function(){this.Idx=0,this.Pt=new e.IntPoint0,this.Next=null,this.Prev=null},e.Join=function(){this.OutPt1=null,this.OutPt2=null,this.OffPt=new e.IntPoint0},e.ClipperBase=function(){this.m_MinimaList=null,this.m_CurrentLM=null,this.m_edges=new Array,this.m_UseFullRange=!1,this.m_HasOpenPaths=!1,this.PreserveCollinear=!1,this.m_Scanbeam=null,this.m_PolyOuts=null,this.m_ActiveEdges=null},e.ClipperBase.horizontal=-9007199254740992,e.ClipperBase.Skip=-2,e.ClipperBase.Unassigned=-1,e.ClipperBase.tolerance=1e-20,e.ClipperBase.loRange=47453132,e.ClipperBase.hiRange=0xfffffffffffff,e.ClipperBase.near_zero=function(i){return i>-e.ClipperBase.tolerance&&i<e.ClipperBase.tolerance},e.ClipperBase.IsHorizontal=function(i){return i.Delta.Y===0},e.ClipperBase.prototype.PointIsVertex=function(i,o){var u=o;do{if(e.IntPoint.op_Equality(u.Pt,i))return!0;u=u.Next}while(u!==o);return!1},e.ClipperBase.prototype.PointOnLineSegment=function(i,o,u,h){return h?i.X===o.X&&i.Y===o.Y||i.X===u.X&&i.Y===u.Y||i.X>o.X==i.X<u.X&&i.Y>o.Y==i.Y<u.Y&&We.op_Equality(We.Int128Mul(i.X-o.X,u.Y-o.Y),We.Int128Mul(u.X-o.X,i.Y-o.Y)):i.X===o.X&&i.Y===o.Y||i.X===u.X&&i.Y===u.Y||i.X>o.X==i.X<u.X&&i.Y>o.Y==i.Y<u.Y&&(i.X-o.X)*(u.Y-o.Y)===(u.X-o.X)*(i.Y-o.Y)},e.ClipperBase.prototype.PointOnPolygon=function(i,o,u){for(var h=o;;){if(this.PointOnLineSegment(i,h.Pt,h.Next.Pt,u))return!0;if(h=h.Next,h===o)break}return!1},e.ClipperBase.prototype.SlopesEqual=e.ClipperBase.SlopesEqual=function(){var i=arguments,o=i.length,u,h,v,I,A,D,z;return o===3?(u=i[0],h=i[1],z=i[2],z?We.op_Equality(We.Int128Mul(u.Delta.Y,h.Delta.X),We.Int128Mul(u.Delta.X,h.Delta.Y)):e.Cast_Int64(u.Delta.Y*h.Delta.X)===e.Cast_Int64(u.Delta.X*h.Delta.Y)):o===4?(v=i[0],I=i[1],A=i[2],z=i[3],z?We.op_Equality(We.Int128Mul(v.Y-I.Y,I.X-A.X),We.Int128Mul(v.X-I.X,I.Y-A.Y)):e.Cast_Int64((v.Y-I.Y)*(I.X-A.X))-e.Cast_Int64((v.X-I.X)*(I.Y-A.Y))===0):(v=i[0],I=i[1],A=i[2],D=i[3],z=i[4],z?We.op_Equality(We.Int128Mul(v.Y-I.Y,A.X-D.X),We.Int128Mul(v.X-I.X,A.Y-D.Y)):e.Cast_Int64((v.Y-I.Y)*(A.X-D.X))-e.Cast_Int64((v.X-I.X)*(A.Y-D.Y))===0)},e.ClipperBase.SlopesEqual3=function(i,o,u){return u?We.op_Equality(We.Int128Mul(i.Delta.Y,o.Delta.X),We.Int128Mul(i.Delta.X,o.Delta.Y)):e.Cast_Int64(i.Delta.Y*o.Delta.X)===e.Cast_Int64(i.Delta.X*o.Delta.Y)},e.ClipperBase.SlopesEqual4=function(i,o,u,h){return h?We.op_Equality(We.Int128Mul(i.Y-o.Y,o.X-u.X),We.Int128Mul(i.X-o.X,o.Y-u.Y)):e.Cast_Int64((i.Y-o.Y)*(o.X-u.X))-e.Cast_Int64((i.X-o.X)*(o.Y-u.Y))===0},e.ClipperBase.SlopesEqual5=function(i,o,u,h,v){return v?We.op_Equality(We.Int128Mul(i.Y-o.Y,u.X-h.X),We.Int128Mul(i.X-o.X,u.Y-h.Y)):e.Cast_Int64((i.Y-o.Y)*(u.X-h.X))-e.Cast_Int64((i.X-o.X)*(u.Y-h.Y))===0},e.ClipperBase.prototype.Clear=function(){this.DisposeLocalMinimaList();for(var i=0,o=this.m_edges.length;i<o;++i){for(var u=0,h=this.m_edges[i].length;u<h;++u)this.m_edges[i][u]=null;e.Clear(this.m_edges[i])}e.Clear(this.m_edges),this.m_UseFullRange=!1,this.m_HasOpenPaths=!1},e.ClipperBase.prototype.DisposeLocalMinimaList=function(){for(;this.m_MinimaList!==null;){var i=this.m_MinimaList.Next;this.m_MinimaList=null,this.m_MinimaList=i}this.m_CurrentLM=null},e.ClipperBase.prototype.RangeTest=function(i,o){o.Value?(i.X>e.ClipperBase.hiRange||i.Y>e.ClipperBase.hiRange||-i.X>e.ClipperBase.hiRange||-i.Y>e.ClipperBase.hiRange)&&e.Error("Coordinate outside allowed range in RangeTest()."):(i.X>e.ClipperBase.loRange||i.Y>e.ClipperBase.loRange||-i.X>e.ClipperBase.loRange||-i.Y>e.ClipperBase.loRange)&&(o.Value=!0,this.RangeTest(i,o))},e.ClipperBase.prototype.InitEdge=function(i,o,u,h){i.Next=o,i.Prev=u,i.Curr.X=h.X,i.Curr.Y=h.Y,e.use_xyz&&(i.Curr.Z=h.Z),i.OutIdx=-1},e.ClipperBase.prototype.InitEdge2=function(i,o){i.Curr.Y>=i.Next.Curr.Y?(i.Bot.X=i.Curr.X,i.Bot.Y=i.Curr.Y,e.use_xyz&&(i.Bot.Z=i.Curr.Z),i.Top.X=i.Next.Curr.X,i.Top.Y=i.Next.Curr.Y,e.use_xyz&&(i.Top.Z=i.Next.Curr.Z)):(i.Top.X=i.Curr.X,i.Top.Y=i.Curr.Y,e.use_xyz&&(i.Top.Z=i.Curr.Z),i.Bot.X=i.Next.Curr.X,i.Bot.Y=i.Next.Curr.Y,e.use_xyz&&(i.Bot.Z=i.Next.Curr.Z)),this.SetDx(i),i.PolyTyp=o},e.ClipperBase.prototype.FindNextLocMin=function(i){for(var o;;){for(;e.IntPoint.op_Inequality(i.Bot,i.Prev.Bot)||e.IntPoint.op_Equality(i.Curr,i.Top);)i=i.Next;if(i.Dx!==e.ClipperBase.horizontal&&i.Prev.Dx!==e.ClipperBase.horizontal)break;for(;i.Prev.Dx===e.ClipperBase.horizontal;)i=i.Prev;for(o=i;i.Dx===e.ClipperBase.horizontal;)i=i.Next;if(i.Top.Y!==i.Prev.Bot.Y){o.Prev.Bot.X<i.Bot.X&&(i=o);break}}return i},e.ClipperBase.prototype.ProcessBound=function(i,o){var u,h=i,v;if(h.OutIdx===e.ClipperBase.Skip){if(i=h,o){for(;i.Top.Y===i.Next.Bot.Y;)i=i.Next;for(;i!==h&&i.Dx===e.ClipperBase.horizontal;)i=i.Prev}else{for(;i.Top.Y===i.Prev.Bot.Y;)i=i.Prev;for(;i!==h&&i.Dx===e.ClipperBase.horizontal;)i=i.Next}if(i===h)o?h=i.Next:h=i.Prev;else{o?i=h.Next:i=h.Prev;var I=new e.LocalMinima;I.Next=null,I.Y=i.Bot.Y,I.LeftBound=null,I.RightBound=i,i.WindDelta=0,h=this.ProcessBound(i,o),this.InsertLocalMinima(I)}return h}if(i.Dx===e.ClipperBase.horizontal&&(o?u=i.Prev:u=i.Next,u.Dx===e.ClipperBase.horizontal?u.Bot.X!==i.Bot.X&&u.Top.X!==i.Bot.X&&this.ReverseHorizontal(i):u.Bot.X!==i.Bot.X&&this.ReverseHorizontal(i)),u=i,o){for(;h.Top.Y===h.Next.Bot.Y&&h.Next.OutIdx!==e.ClipperBase.Skip;)h=h.Next;if(h.Dx===e.ClipperBase.horizontal&&h.Next.OutIdx!==e.ClipperBase.Skip){for(v=h;v.Prev.Dx===e.ClipperBase.horizontal;)v=v.Prev;v.Prev.Top.X>h.Next.Top.X&&(h=v.Prev)}for(;i!==h;)i.NextInLML=i.Next,i.Dx===e.ClipperBase.horizontal&&i!==u&&i.Bot.X!==i.Prev.Top.X&&this.ReverseHorizontal(i),i=i.Next;i.Dx===e.ClipperBase.horizontal&&i!==u&&i.Bot.X!==i.Prev.Top.X&&this.ReverseHorizontal(i),h=h.Next}else{for(;h.Top.Y===h.Prev.Bot.Y&&h.Prev.OutIdx!==e.ClipperBase.Skip;)h=h.Prev;if(h.Dx===e.ClipperBase.horizontal&&h.Prev.OutIdx!==e.ClipperBase.Skip){for(v=h;v.Next.Dx===e.ClipperBase.horizontal;)v=v.Next;(v.Next.Top.X===h.Prev.Top.X||v.Next.Top.X>h.Prev.Top.X)&&(h=v.Next)}for(;i!==h;)i.NextInLML=i.Prev,i.Dx===e.ClipperBase.horizontal&&i!==u&&i.Bot.X!==i.Next.Top.X&&this.ReverseHorizontal(i),i=i.Prev;i.Dx===e.ClipperBase.horizontal&&i!==u&&i.Bot.X!==i.Next.Top.X&&this.ReverseHorizontal(i),h=h.Prev}return h},e.ClipperBase.prototype.AddPath=function(i,o,u){e.use_lines?!u&&o===e.PolyType.ptClip&&e.Error("AddPath: Open paths must be subject."):u||e.Error("AddPath: Open paths have been disabled.");var h=i.length-1;if(u)for(;h>0&&e.IntPoint.op_Equality(i[h],i[0]);)--h;for(;h>0&&e.IntPoint.op_Equality(i[h],i[h-1]);)--h;if(u&&h<2||!u&&h<1)return!1;for(var v=new Array,I=0;I<=h;I++)v.push(new e.TEdge);var A=!0;v[1].Curr.X=i[1].X,v[1].Curr.Y=i[1].Y,e.use_xyz&&(v[1].Curr.Z=i[1].Z);var D={Value:this.m_UseFullRange};this.RangeTest(i[0],D),this.m_UseFullRange=D.Value,D.Value=this.m_UseFullRange,this.RangeTest(i[h],D),this.m_UseFullRange=D.Value,this.InitEdge(v[0],v[1],v[h],i[0]),this.InitEdge(v[h],v[0],v[h-1],i[h]);for(var I=h-1;I>=1;--I)D.Value=this.m_UseFullRange,this.RangeTest(i[I],D),this.m_UseFullRange=D.Value,this.InitEdge(v[I],v[I+1],v[I-1],i[I]);for(var z=v[0],H=z,ae=z;;){if(H.Curr===H.Next.Curr&&(u||H.Next!==z)){if(H===H.Next)break;H===z&&(z=H.Next),H=this.RemoveEdge(H),ae=H;continue}if(H.Prev===H.Next)break;if(u&&e.ClipperBase.SlopesEqual4(H.Prev.Curr,H.Curr,H.Next.Curr,this.m_UseFullRange)&&(!this.PreserveCollinear||!this.Pt2IsBetweenPt1AndPt3(H.Prev.Curr,H.Curr,H.Next.Curr))){H===z&&(z=H.Next),H=this.RemoveEdge(H),H=H.Prev,ae=H;continue}if(H=H.Next,H===ae||!u&&H.Next===z)break}if(!u&&H===H.Next||u&&H.Prev===H.Next)return!1;u||(this.m_HasOpenPaths=!0,z.Prev.OutIdx=e.ClipperBase.Skip),H=z;do this.InitEdge2(H,o),H=H.Next,A&&H.Curr.Y!==z.Curr.Y&&(A=!1);while(H!==z);if(A){if(u)return!1;H.Prev.OutIdx=e.ClipperBase.Skip;var te=new e.LocalMinima;for(te.Next=null,te.Y=H.Bot.Y,te.LeftBound=null,te.RightBound=H,te.RightBound.Side=e.EdgeSide.esRight,te.RightBound.WindDelta=0;H.Bot.X!==H.Prev.Top.X&&this.ReverseHorizontal(H),H.Next.OutIdx!==e.ClipperBase.Skip;)H.NextInLML=H.Next,H=H.Next;return this.InsertLocalMinima(te),this.m_edges.push(v),!0}this.m_edges.push(v);var ge,Ne=null;for(e.IntPoint.op_Equality(H.Prev.Bot,H.Prev.Top)&&(H=H.Next);H=this.FindNextLocMin(H),H!==Ne;){Ne===null&&(Ne=H);var te=new e.LocalMinima;te.Next=null,te.Y=H.Bot.Y,H.Dx<H.Prev.Dx?(te.LeftBound=H.Prev,te.RightBound=H,ge=!1):(te.LeftBound=H,te.RightBound=H.Prev,ge=!0),te.LeftBound.Side=e.EdgeSide.esLeft,te.RightBound.Side=e.EdgeSide.esRight,u?te.LeftBound.Next===te.RightBound?te.LeftBound.WindDelta=-1:te.LeftBound.WindDelta=1:te.LeftBound.WindDelta=0,te.RightBound.WindDelta=-te.LeftBound.WindDelta,H=this.ProcessBound(te.LeftBound,ge),H.OutIdx===e.ClipperBase.Skip&&(H=this.ProcessBound(H,ge));var Xe=this.ProcessBound(te.RightBound,!ge);Xe.OutIdx===e.ClipperBase.Skip&&(Xe=this.ProcessBound(Xe,!ge)),te.LeftBound.OutIdx===e.ClipperBase.Skip?te.LeftBound=null:te.RightBound.OutIdx===e.ClipperBase.Skip&&(te.RightBound=null),this.InsertLocalMinima(te),ge||(H=Xe)}return!0},e.ClipperBase.prototype.AddPaths=function(i,o,u){for(var h=!1,v=0,I=i.length;v<I;++v)this.AddPath(i[v],o,u)&&(h=!0);return h},e.ClipperBase.prototype.Pt2IsBetweenPt1AndPt3=function(i,o,u){return e.IntPoint.op_Equality(i,u)||e.IntPoint.op_Equality(i,o)||e.IntPoint.op_Equality(u,o)?!1:i.X!==u.X?o.X>i.X==o.X<u.X:o.Y>i.Y==o.Y<u.Y},e.ClipperBase.prototype.RemoveEdge=function(i){i.Prev.Next=i.Next,i.Next.Prev=i.Prev;var o=i.Next;return i.Prev=null,o},e.ClipperBase.prototype.SetDx=function(i){i.Delta.X=i.Top.X-i.Bot.X,i.Delta.Y=i.Top.Y-i.Bot.Y,i.Delta.Y===0?i.Dx=e.ClipperBase.horizontal:i.Dx=i.Delta.X/i.Delta.Y},e.ClipperBase.prototype.InsertLocalMinima=function(i){if(this.m_MinimaList===null)this.m_MinimaList=i;else if(i.Y>=this.m_MinimaList.Y)i.Next=this.m_MinimaList,this.m_MinimaList=i;else{for(var o=this.m_MinimaList;o.Next!==null&&i.Y<o.Next.Y;)o=o.Next;i.Next=o.Next,o.Next=i}},e.ClipperBase.prototype.PopLocalMinima=function(i,o){return o.v=this.m_CurrentLM,this.m_CurrentLM!==null&&this.m_CurrentLM.Y===i?(this.m_CurrentLM=this.m_CurrentLM.Next,!0):!1},e.ClipperBase.prototype.ReverseHorizontal=function(i){var o=i.Top.X;i.Top.X=i.Bot.X,i.Bot.X=o,e.use_xyz&&(o=i.Top.Z,i.Top.Z=i.Bot.Z,i.Bot.Z=o)},e.ClipperBase.prototype.Reset=function(){if(this.m_CurrentLM=this.m_MinimaList,this.m_CurrentLM!==null){this.m_Scanbeam=null;for(var i=this.m_MinimaList;i!==null;){this.InsertScanbeam(i.Y);var o=i.LeftBound;o!==null&&(o.Curr.X=o.Bot.X,o.Curr.Y=o.Bot.Y,e.use_xyz&&(o.Curr.Z=o.Bot.Z),o.OutIdx=e.ClipperBase.Unassigned),o=i.RightBound,o!==null&&(o.Curr.X=o.Bot.X,o.Curr.Y=o.Bot.Y,e.use_xyz&&(o.Curr.Z=o.Bot.Z),o.OutIdx=e.ClipperBase.Unassigned),i=i.Next}this.m_ActiveEdges=null}},e.ClipperBase.prototype.InsertScanbeam=function(i){if(this.m_Scanbeam===null)this.m_Scanbeam=new e.Scanbeam,this.m_Scanbeam.Next=null,this.m_Scanbeam.Y=i;else if(i>this.m_Scanbeam.Y){var o=new e.Scanbeam;o.Y=i,o.Next=this.m_Scanbeam,this.m_Scanbeam=o}else{for(var u=this.m_Scanbeam;u.Next!==null&&i<=u.Next.Y;)u=u.Next;if(i===u.Y)return;var h=new e.Scanbeam;h.Y=i,h.Next=u.Next,u.Next=h}},e.ClipperBase.prototype.PopScanbeam=function(i){return this.m_Scanbeam===null?(i.v=0,!1):(i.v=this.m_Scanbeam.Y,this.m_Scanbeam=this.m_Scanbeam.Next,!0)},e.ClipperBase.prototype.LocalMinimaPending=function(){return this.m_CurrentLM!==null},e.ClipperBase.prototype.CreateOutRec=function(){var i=new e.OutRec;return i.Idx=e.ClipperBase.Unassigned,i.IsHole=!1,i.IsOpen=!1,i.FirstLeft=null,i.Pts=null,i.BottomPt=null,i.PolyNode=null,this.m_PolyOuts.push(i),i.Idx=this.m_PolyOuts.length-1,i},e.ClipperBase.prototype.DisposeOutRec=function(i){var o=this.m_PolyOuts[i];o.Pts=null,o=null,this.m_PolyOuts[i]=null},e.ClipperBase.prototype.UpdateEdgeIntoAEL=function(i){i.NextInLML===null&&e.Error("UpdateEdgeIntoAEL: invalid call");var o=i.PrevInAEL,u=i.NextInAEL;return i.NextInLML.OutIdx=i.OutIdx,o!==null?o.NextInAEL=i.NextInLML:this.m_ActiveEdges=i.NextInLML,u!==null&&(u.PrevInAEL=i.NextInLML),i.NextInLML.Side=i.Side,i.NextInLML.WindDelta=i.WindDelta,i.NextInLML.WindCnt=i.WindCnt,i.NextInLML.WindCnt2=i.WindCnt2,i=i.NextInLML,i.Curr.X=i.Bot.X,i.Curr.Y=i.Bot.Y,i.PrevInAEL=o,i.NextInAEL=u,e.ClipperBase.IsHorizontal(i)||this.InsertScanbeam(i.Top.Y),i},e.ClipperBase.prototype.SwapPositionsInAEL=function(i,o){if(!(i.NextInAEL===i.PrevInAEL||o.NextInAEL===o.PrevInAEL)){if(i.NextInAEL===o){var u=o.NextInAEL;u!==null&&(u.PrevInAEL=i);var h=i.PrevInAEL;h!==null&&(h.NextInAEL=o),o.PrevInAEL=h,o.NextInAEL=i,i.PrevInAEL=o,i.NextInAEL=u}else if(o.NextInAEL===i){var v=i.NextInAEL;v!==null&&(v.PrevInAEL=o);var I=o.PrevInAEL;I!==null&&(I.NextInAEL=i),i.PrevInAEL=I,i.NextInAEL=o,o.PrevInAEL=i,o.NextInAEL=v}else{var A=i.NextInAEL,D=i.PrevInAEL;i.NextInAEL=o.NextInAEL,i.NextInAEL!==null&&(i.NextInAEL.PrevInAEL=i),i.PrevInAEL=o.PrevInAEL,i.PrevInAEL!==null&&(i.PrevInAEL.NextInAEL=i),o.NextInAEL=A,o.NextInAEL!==null&&(o.NextInAEL.PrevInAEL=o),o.PrevInAEL=D,o.PrevInAEL!==null&&(o.PrevInAEL.NextInAEL=o)}i.PrevInAEL===null?this.m_ActiveEdges=i:o.PrevInAEL===null&&(this.m_ActiveEdges=o)}},e.ClipperBase.prototype.DeleteFromAEL=function(i){var o=i.PrevInAEL,u=i.NextInAEL;o===null&&u===null&&i!==this.m_ActiveEdges||(o!==null?o.NextInAEL=u:this.m_ActiveEdges=u,u!==null&&(u.PrevInAEL=o),i.NextInAEL=null,i.PrevInAEL=null)},e.Clipper=function(i){typeof i>"u"&&(i=0),this.m_PolyOuts=null,this.m_ClipType=e.ClipType.ctIntersection,this.m_Scanbeam=null,this.m_Maxima=null,this.m_ActiveEdges=null,this.m_SortedEdges=null,this.m_IntersectList=null,this.m_IntersectNodeComparer=null,this.m_ExecuteLocked=!1,this.m_ClipFillType=e.PolyFillType.pftEvenOdd,this.m_SubjFillType=e.PolyFillType.pftEvenOdd,this.m_Joins=null,this.m_GhostJoins=null,this.m_UsingPolyTree=!1,this.ReverseSolution=!1,this.StrictlySimple=!1,e.ClipperBase.call(this),this.m_Scanbeam=null,this.m_Maxima=null,this.m_ActiveEdges=null,this.m_SortedEdges=null,this.m_IntersectList=new Array,this.m_IntersectNodeComparer=e.MyIntersectNodeSort.Compare,this.m_ExecuteLocked=!1,this.m_UsingPolyTree=!1,this.m_PolyOuts=new Array,this.m_Joins=new Array,this.m_GhostJoins=new Array,this.ReverseSolution=(1&i)!==0,this.StrictlySimple=(2&i)!==0,this.PreserveCollinear=(4&i)!==0,e.use_xyz&&(this.ZFillFunction=null)},e.Clipper.ioReverseSolution=1,e.Clipper.ioStrictlySimple=2,e.Clipper.ioPreserveCollinear=4,e.Clipper.prototype.Clear=function(){this.m_edges.length!==0&&(this.DisposeAllPolyPts(),e.ClipperBase.prototype.Clear.call(this))},e.Clipper.prototype.InsertMaxima=function(i){var o=new e.Maxima;if(o.X=i,this.m_Maxima===null)this.m_Maxima=o,this.m_Maxima.Next=null,this.m_Maxima.Prev=null;else if(i<this.m_Maxima.X)o.Next=this.m_Maxima,o.Prev=null,this.m_Maxima=o;else{for(var u=this.m_Maxima;u.Next!==null&&i>=u.Next.X;)u=u.Next;if(i===u.X)return;o.Next=u.Next,o.Prev=u,u.Next!==null&&(u.Next.Prev=o),u.Next=o}},e.Clipper.prototype.Execute=function(){var i=arguments,o=i.length,u=i[1]instanceof e.PolyTree;if(o===4&&!u){var h=i[0],v=i[1],I=i[2],A=i[3];if(this.m_ExecuteLocked)return!1;this.m_HasOpenPaths&&e.Error("Error: PolyTree struct is needed for open path clipping."),this.m_ExecuteLocked=!0,e.Clear(v),this.m_SubjFillType=I,this.m_ClipFillType=A,this.m_ClipType=h,this.m_UsingPolyTree=!1;try{var D=this.ExecuteInternal();D&&this.BuildResult(v)}finally{this.DisposeAllPolyPts(),this.m_ExecuteLocked=!1}return D}else if(o===4&&u){var h=i[0],z=i[1],I=i[2],A=i[3];if(this.m_ExecuteLocked)return!1;this.m_ExecuteLocked=!0,this.m_SubjFillType=I,this.m_ClipFillType=A,this.m_ClipType=h,this.m_UsingPolyTree=!0;try{var D=this.ExecuteInternal();D&&this.BuildResult2(z)}finally{this.DisposeAllPolyPts(),this.m_ExecuteLocked=!1}return D}else if(o===2&&!u){var h=i[0],v=i[1];return this.Execute(h,v,e.PolyFillType.pftEvenOdd,e.PolyFillType.pftEvenOdd)}else if(o===2&&u){var h=i[0],z=i[1];return this.Execute(h,z,e.PolyFillType.pftEvenOdd,e.PolyFillType.pftEvenOdd)}},e.Clipper.prototype.FixHoleLinkage=function(i){if(!(i.FirstLeft===null||i.IsHole!==i.FirstLeft.IsHole&&i.FirstLeft.Pts!==null)){for(var o=i.FirstLeft;o!==null&&(o.IsHole===i.IsHole||o.Pts===null);)o=o.FirstLeft;i.FirstLeft=o}},e.Clipper.prototype.ExecuteInternal=function(){try{this.Reset(),this.m_SortedEdges=null,this.m_Maxima=null;var i={},o={};if(!this.PopScanbeam(i))return!1;for(this.InsertLocalMinimaIntoAEL(i.v);this.PopScanbeam(o)||this.LocalMinimaPending();){if(this.ProcessHorizontals(),this.m_GhostJoins.length=0,!this.ProcessIntersections(o.v))return!1;this.ProcessEdgesAtTopOfScanbeam(o.v),i.v=o.v,this.InsertLocalMinimaIntoAEL(i.v)}var u,h,v;for(h=0,v=this.m_PolyOuts.length;h<v;h++)u=this.m_PolyOuts[h],!(u.Pts===null||u.IsOpen)&&(u.IsHole^this.ReverseSolution)==this.Area$1(u)>0&&this.ReversePolyPtLinks(u.Pts);for(this.JoinCommonEdges(),h=0,v=this.m_PolyOuts.length;h<v;h++)u=this.m_PolyOuts[h],u.Pts!==null&&(u.IsOpen?this.FixupOutPolyline(u):this.FixupOutPolygon(u));return this.StrictlySimple&&this.DoSimplePolygons(),!0}finally{this.m_Joins.length=0,this.m_GhostJoins.length=0}},e.Clipper.prototype.DisposeAllPolyPts=function(){for(var i=0,o=this.m_PolyOuts.length;i<o;++i)this.DisposeOutRec(i);e.Clear(this.m_PolyOuts)},e.Clipper.prototype.AddJoin=function(i,o,u){var h=new e.Join;h.OutPt1=i,h.OutPt2=o,h.OffPt.X=u.X,h.OffPt.Y=u.Y,e.use_xyz&&(h.OffPt.Z=u.Z),this.m_Joins.push(h)},e.Clipper.prototype.AddGhostJoin=function(i,o){var u=new e.Join;u.OutPt1=i,u.OffPt.X=o.X,u.OffPt.Y=o.Y,e.use_xyz&&(u.OffPt.Z=o.Z),this.m_GhostJoins.push(u)},e.Clipper.prototype.SetZ=function(i,o,u){if(this.ZFillFunction!==null){if(i.Z!==0||this.ZFillFunction===null)return;e.IntPoint.op_Equality(i,o.Bot)?i.Z=o.Bot.Z:e.IntPoint.op_Equality(i,o.Top)?i.Z=o.Top.Z:e.IntPoint.op_Equality(i,u.Bot)?i.Z=u.Bot.Z:e.IntPoint.op_Equality(i,u.Top)?i.Z=u.Top.Z:this.ZFillFunction(o.Bot,o.Top,u.Bot,u.Top,i)}},e.Clipper.prototype.InsertLocalMinimaIntoAEL=function(i){for(var o={},u,h;this.PopLocalMinima(i,o);){u=o.v.LeftBound,h=o.v.RightBound;var v=null;if(u===null?(this.InsertEdgeIntoAEL(h,null),this.SetWindingCount(h),this.IsContributing(h)&&(v=this.AddOutPt(h,h.Bot))):h===null?(this.InsertEdgeIntoAEL(u,null),this.SetWindingCount(u),this.IsContributing(u)&&(v=this.AddOutPt(u,u.Bot)),this.InsertScanbeam(u.Top.Y)):(this.InsertEdgeIntoAEL(u,null),this.InsertEdgeIntoAEL(h,u),this.SetWindingCount(u),h.WindCnt=u.WindCnt,h.WindCnt2=u.WindCnt2,this.IsContributing(u)&&(v=this.AddLocalMinPoly(u,h,u.Bot)),this.InsertScanbeam(u.Top.Y)),h!==null&&(e.ClipperBase.IsHorizontal(h)?(h.NextInLML!==null&&this.InsertScanbeam(h.NextInLML.Top.Y),this.AddEdgeToSEL(h)):this.InsertScanbeam(h.Top.Y)),!(u===null||h===null)){if(v!==null&&e.ClipperBase.IsHorizontal(h)&&this.m_GhostJoins.length>0&&h.WindDelta!==0)for(var I=0,A=this.m_GhostJoins.length;I<A;I++){var D=this.m_GhostJoins[I];this.HorzSegmentsOverlap(D.OutPt1.Pt.X,D.OffPt.X,h.Bot.X,h.Top.X)&&this.AddJoin(D.OutPt1,v,D.OffPt)}if(u.OutIdx>=0&&u.PrevInAEL!==null&&u.PrevInAEL.Curr.X===u.Bot.X&&u.PrevInAEL.OutIdx>=0&&e.ClipperBase.SlopesEqual5(u.PrevInAEL.Curr,u.PrevInAEL.Top,u.Curr,u.Top,this.m_UseFullRange)&&u.WindDelta!==0&&u.PrevInAEL.WindDelta!==0){var z=this.AddOutPt(u.PrevInAEL,u.Bot);this.AddJoin(v,z,u.Top)}if(u.NextInAEL!==h){if(h.OutIdx>=0&&h.PrevInAEL.OutIdx>=0&&e.ClipperBase.SlopesEqual5(h.PrevInAEL.Curr,h.PrevInAEL.Top,h.Curr,h.Top,this.m_UseFullRange)&&h.WindDelta!==0&&h.PrevInAEL.WindDelta!==0){var z=this.AddOutPt(h.PrevInAEL,h.Bot);this.AddJoin(v,z,h.Top)}var H=u.NextInAEL;if(H!==null)for(;H!==h;)this.IntersectEdges(h,H,u.Curr),H=H.NextInAEL}}}},e.Clipper.prototype.InsertEdgeIntoAEL=function(i,o){if(this.m_ActiveEdges===null)i.PrevInAEL=null,i.NextInAEL=null,this.m_ActiveEdges=i;else if(o===null&&this.E2InsertsBeforeE1(this.m_ActiveEdges,i))i.PrevInAEL=null,i.NextInAEL=this.m_ActiveEdges,this.m_ActiveEdges.PrevInAEL=i,this.m_ActiveEdges=i;else{for(o===null&&(o=this.m_ActiveEdges);o.NextInAEL!==null&&!this.E2InsertsBeforeE1(o.NextInAEL,i);)o=o.NextInAEL;i.NextInAEL=o.NextInAEL,o.NextInAEL!==null&&(o.NextInAEL.PrevInAEL=i),i.PrevInAEL=o,o.NextInAEL=i}},e.Clipper.prototype.E2InsertsBeforeE1=function(i,o){return o.Curr.X===i.Curr.X?o.Top.Y>i.Top.Y?o.Top.X<e.Clipper.TopX(i,o.Top.Y):i.Top.X>e.Clipper.TopX(o,i.Top.Y):o.Curr.X<i.Curr.X},e.Clipper.prototype.IsEvenOddFillType=function(i){return i.PolyTyp===e.PolyType.ptSubject?this.m_SubjFillType===e.PolyFillType.pftEvenOdd:this.m_ClipFillType===e.PolyFillType.pftEvenOdd},e.Clipper.prototype.IsEvenOddAltFillType=function(i){return i.PolyTyp===e.PolyType.ptSubject?this.m_ClipFillType===e.PolyFillType.pftEvenOdd:this.m_SubjFillType===e.PolyFillType.pftEvenOdd},e.Clipper.prototype.IsContributing=function(i){var o,u;switch(i.PolyTyp===e.PolyType.ptSubject?(o=this.m_SubjFillType,u=this.m_ClipFillType):(o=this.m_ClipFillType,u=this.m_SubjFillType),o){case e.PolyFillType.pftEvenOdd:if(i.WindDelta===0&&i.WindCnt!==1)return!1;break;case e.PolyFillType.pftNonZero:if(Math.abs(i.WindCnt)!==1)return!1;break;case e.PolyFillType.pftPositive:if(i.WindCnt!==1)return!1;break;default:if(i.WindCnt!==-1)return!1;break}switch(this.m_ClipType){case e.ClipType.ctIntersection:switch(u){case e.PolyFillType.pftEvenOdd:case e.PolyFillType.pftNonZero:return i.WindCnt2!==0;case e.PolyFillType.pftPositive:return i.WindCnt2>0;default:return i.WindCnt2<0}case e.ClipType.ctUnion:switch(u){case e.PolyFillType.pftEvenOdd:case e.PolyFillType.pftNonZero:return i.WindCnt2===0;case e.PolyFillType.pftPositive:return i.WindCnt2<=0;default:return i.WindCnt2>=0}case e.ClipType.ctDifference:if(i.PolyTyp===e.PolyType.ptSubject)switch(u){case e.PolyFillType.pftEvenOdd:case e.PolyFillType.pftNonZero:return i.WindCnt2===0;case e.PolyFillType.pftPositive:return i.WindCnt2<=0;default:return i.WindCnt2>=0}else switch(u){case e.PolyFillType.pftEvenOdd:case e.PolyFillType.pftNonZero:return i.WindCnt2!==0;case e.PolyFillType.pftPositive:return i.WindCnt2>0;default:return i.WindCnt2<0}case e.ClipType.ctXor:if(i.WindDelta===0)switch(u){case e.PolyFillType.pftEvenOdd:case e.PolyFillType.pftNonZero:return i.WindCnt2===0;case e.PolyFillType.pftPositive:return i.WindCnt2<=0;default:return i.WindCnt2>=0}else return!0}return!0},e.Clipper.prototype.SetWindingCount=function(i){for(var o=i.PrevInAEL;o!==null&&(o.PolyTyp!==i.PolyTyp||o.WindDelta===0);)o=o.PrevInAEL;if(o===null){var u=i.PolyTyp===e.PolyType.ptSubject?this.m_SubjFillType:this.m_ClipFillType;i.WindDelta===0?i.WindCnt=u===e.PolyFillType.pftNegative?-1:1:i.WindCnt=i.WindDelta,i.WindCnt2=0,o=this.m_ActiveEdges}else if(i.WindDelta===0&&this.m_ClipType!==e.ClipType.ctUnion)i.WindCnt=1,i.WindCnt2=o.WindCnt2,o=o.NextInAEL;else if(this.IsEvenOddFillType(i)){if(i.WindDelta===0){for(var h=!0,v=o.PrevInAEL;v!==null;)v.PolyTyp===o.PolyTyp&&v.WindDelta!==0&&(h=!h),v=v.PrevInAEL;i.WindCnt=h?0:1}else i.WindCnt=i.WindDelta;i.WindCnt2=o.WindCnt2,o=o.NextInAEL}else o.WindCnt*o.WindDelta<0?Math.abs(o.WindCnt)>1?o.WindDelta*i.WindDelta<0?i.WindCnt=o.WindCnt:i.WindCnt=o.WindCnt+i.WindDelta:i.WindCnt=i.WindDelta===0?1:i.WindDelta:i.WindDelta===0?i.WindCnt=o.WindCnt<0?o.WindCnt-1:o.WindCnt+1:o.WindDelta*i.WindDelta<0?i.WindCnt=o.WindCnt:i.WindCnt=o.WindCnt+i.WindDelta,i.WindCnt2=o.WindCnt2,o=o.NextInAEL;if(this.IsEvenOddAltFillType(i))for(;o!==i;)o.WindDelta!==0&&(i.WindCnt2=i.WindCnt2===0?1:0),o=o.NextInAEL;else for(;o!==i;)i.WindCnt2+=o.WindDelta,o=o.NextInAEL},e.Clipper.prototype.AddEdgeToSEL=function(i){this.m_SortedEdges===null?(this.m_SortedEdges=i,i.PrevInSEL=null,i.NextInSEL=null):(i.NextInSEL=this.m_SortedEdges,i.PrevInSEL=null,this.m_SortedEdges.PrevInSEL=i,this.m_SortedEdges=i)},e.Clipper.prototype.PopEdgeFromSEL=function(i){if(i.v=this.m_SortedEdges,i.v===null)return!1;var o=i.v;return this.m_SortedEdges=i.v.NextInSEL,this.m_SortedEdges!==null&&(this.m_SortedEdges.PrevInSEL=null),o.NextInSEL=null,o.PrevInSEL=null,!0},e.Clipper.prototype.CopyAELToSEL=function(){var i=this.m_ActiveEdges;for(this.m_SortedEdges=i;i!==null;)i.PrevInSEL=i.PrevInAEL,i.NextInSEL=i.NextInAEL,i=i.NextInAEL},e.Clipper.prototype.SwapPositionsInSEL=function(i,o){if(!(i.NextInSEL===null&&i.PrevInSEL===null)&&!(o.NextInSEL===null&&o.PrevInSEL===null)){if(i.NextInSEL===o){var u=o.NextInSEL;u!==null&&(u.PrevInSEL=i);var h=i.PrevInSEL;h!==null&&(h.NextInSEL=o),o.PrevInSEL=h,o.NextInSEL=i,i.PrevInSEL=o,i.NextInSEL=u}else if(o.NextInSEL===i){var u=i.NextInSEL;u!==null&&(u.PrevInSEL=o);var h=o.PrevInSEL;h!==null&&(h.NextInSEL=i),i.PrevInSEL=h,i.NextInSEL=o,o.PrevInSEL=i,o.NextInSEL=u}else{var u=i.NextInSEL,h=i.PrevInSEL;i.NextInSEL=o.NextInSEL,i.NextInSEL!==null&&(i.NextInSEL.PrevInSEL=i),i.PrevInSEL=o.PrevInSEL,i.PrevInSEL!==null&&(i.PrevInSEL.NextInSEL=i),o.NextInSEL=u,o.NextInSEL!==null&&(o.NextInSEL.PrevInSEL=o),o.PrevInSEL=h,o.PrevInSEL!==null&&(o.PrevInSEL.NextInSEL=o)}i.PrevInSEL===null?this.m_SortedEdges=i:o.PrevInSEL===null&&(this.m_SortedEdges=o)}},e.Clipper.prototype.AddLocalMaxPoly=function(i,o,u){this.AddOutPt(i,u),o.WindDelta===0&&this.AddOutPt(o,u),i.OutIdx===o.OutIdx?(i.OutIdx=-1,o.OutIdx=-1):i.OutIdx<o.OutIdx?this.AppendPolygon(i,o):this.AppendPolygon(o,i)},e.Clipper.prototype.AddLocalMinPoly=function(i,o,u){var h,v,I;if(e.ClipperBase.IsHorizontal(o)||i.Dx>o.Dx?(h=this.AddOutPt(i,u),o.OutIdx=i.OutIdx,i.Side=e.EdgeSide.esLeft,o.Side=e.EdgeSide.esRight,v=i,v.PrevInAEL===o?I=o.PrevInAEL:I=v.PrevInAEL):(h=this.AddOutPt(o,u),i.OutIdx=o.OutIdx,i.Side=e.EdgeSide.esRight,o.Side=e.EdgeSide.esLeft,v=o,v.PrevInAEL===i?I=i.PrevInAEL:I=v.PrevInAEL),I!==null&&I.OutIdx>=0&&I.Top.Y<u.Y&&v.Top.Y<u.Y){var A=e.Clipper.TopX(I,u.Y),D=e.Clipper.TopX(v,u.Y);if(A===D&&v.WindDelta!==0&&I.WindDelta!==0&&e.ClipperBase.SlopesEqual5(new e.IntPoint2(A,u.Y),I.Top,new e.IntPoint2(D,u.Y),v.Top,this.m_UseFullRange)){var z=this.AddOutPt(I,u);this.AddJoin(h,z,v.Top)}}return h},e.Clipper.prototype.AddOutPt=function(i,o){if(i.OutIdx<0){var u=this.CreateOutRec();u.IsOpen=i.WindDelta===0;var h=new e.OutPt;return u.Pts=h,h.Idx=u.Idx,h.Pt.X=o.X,h.Pt.Y=o.Y,e.use_xyz&&(h.Pt.Z=o.Z),h.Next=h,h.Prev=h,u.IsOpen||this.SetHoleState(i,u),i.OutIdx=u.Idx,h}else{var u=this.m_PolyOuts[i.OutIdx],v=u.Pts,I=i.Side===e.EdgeSide.esLeft;if(I&&e.IntPoint.op_Equality(o,v.Pt))return v;if(!I&&e.IntPoint.op_Equality(o,v.Prev.Pt))return v.Prev;var h=new e.OutPt;return h.Idx=u.Idx,h.Pt.X=o.X,h.Pt.Y=o.Y,e.use_xyz&&(h.Pt.Z=o.Z),h.Next=v,h.Prev=v.Prev,h.Prev.Next=h,v.Prev=h,I&&(u.Pts=h),h}},e.Clipper.prototype.GetLastOutPt=function(i){var o=this.m_PolyOuts[i.OutIdx];return i.Side===e.EdgeSide.esLeft?o.Pts:o.Pts.Prev},e.Clipper.prototype.SwapPoints=function(i,o){var u=new e.IntPoint1(i.Value);i.Value.X=o.Value.X,i.Value.Y=o.Value.Y,e.use_xyz&&(i.Value.Z=o.Value.Z),o.Value.X=u.X,o.Value.Y=u.Y,e.use_xyz&&(o.Value.Z=u.Z)},e.Clipper.prototype.HorzSegmentsOverlap=function(i,o,u,h){var v;return i>o&&(v=i,i=o,o=v),u>h&&(v=u,u=h,h=v),i<h&&u<o},e.Clipper.prototype.SetHoleState=function(i,o){for(var u=i.PrevInAEL,h=null;u!==null;)u.OutIdx>=0&&u.WindDelta!==0&&(h===null?h=u:h.OutIdx===u.OutIdx&&(h=null)),u=u.PrevInAEL;h===null?(o.FirstLeft=null,o.IsHole=!1):(o.FirstLeft=this.m_PolyOuts[h.OutIdx],o.IsHole=!o.FirstLeft.IsHole)},e.Clipper.prototype.GetDx=function(i,o){return i.Y===o.Y?e.ClipperBase.horizontal:(o.X-i.X)/(o.Y-i.Y)},e.Clipper.prototype.FirstIsBottomPt=function(i,o){for(var u=i.Prev;e.IntPoint.op_Equality(u.Pt,i.Pt)&&u!==i;)u=u.Prev;var h=Math.abs(this.GetDx(i.Pt,u.Pt));for(u=i.Next;e.IntPoint.op_Equality(u.Pt,i.Pt)&&u!==i;)u=u.Next;var v=Math.abs(this.GetDx(i.Pt,u.Pt));for(u=o.Prev;e.IntPoint.op_Equality(u.Pt,o.Pt)&&u!==o;)u=u.Prev;var I=Math.abs(this.GetDx(o.Pt,u.Pt));for(u=o.Next;e.IntPoint.op_Equality(u.Pt,o.Pt)&&u!==o;)u=u.Next;var A=Math.abs(this.GetDx(o.Pt,u.Pt));return Math.max(h,v)===Math.max(I,A)&&Math.min(h,v)===Math.min(I,A)?this.Area(i)>0:h>=I&&h>=A||v>=I&&v>=A},e.Clipper.prototype.GetBottomPt=function(i){for(var o=null,u=i.Next;u!==i;)u.Pt.Y>i.Pt.Y?(i=u,o=null):u.Pt.Y===i.Pt.Y&&u.Pt.X<=i.Pt.X&&(u.Pt.X<i.Pt.X?(o=null,i=u):u.Next!==i&&u.Prev!==i&&(o=u)),u=u.Next;if(o!==null)for(;o!==u;)for(this.FirstIsBottomPt(u,o)||(i=o),o=o.Next;e.IntPoint.op_Inequality(o.Pt,i.Pt);)o=o.Next;return i},e.Clipper.prototype.GetLowermostRec=function(i,o){i.BottomPt===null&&(i.BottomPt=this.GetBottomPt(i.Pts)),o.BottomPt===null&&(o.BottomPt=this.GetBottomPt(o.Pts));var u=i.BottomPt,h=o.BottomPt;return u.Pt.Y>h.Pt.Y?i:u.Pt.Y<h.Pt.Y?o:u.Pt.X<h.Pt.X?i:u.Pt.X>h.Pt.X||u.Next===u?o:h.Next===h||this.FirstIsBottomPt(u,h)?i:o},e.Clipper.prototype.OutRec1RightOfOutRec2=function(i,o){do if(i=i.FirstLeft,i===o)return!0;while(i!==null);return!1},e.Clipper.prototype.GetOutRec=function(i){for(var o=this.m_PolyOuts[i];o!==this.m_PolyOuts[o.Idx];)o=this.m_PolyOuts[o.Idx];return o},e.Clipper.prototype.AppendPolygon=function(i,o){var u=this.m_PolyOuts[i.OutIdx],h=this.m_PolyOuts[o.OutIdx],v;this.OutRec1RightOfOutRec2(u,h)?v=h:this.OutRec1RightOfOutRec2(h,u)?v=u:v=this.GetLowermostRec(u,h);var I=u.Pts,A=I.Prev,D=h.Pts,z=D.Prev;i.Side===e.EdgeSide.esLeft?o.Side===e.EdgeSide.esLeft?(this.ReversePolyPtLinks(D),D.Next=I,I.Prev=D,A.Next=z,z.Prev=A,u.Pts=z):(z.Next=I,I.Prev=z,D.Prev=A,A.Next=D,u.Pts=D):o.Side===e.EdgeSide.esRight?(this.ReversePolyPtLinks(D),A.Next=z,z.Prev=A,D.Next=I,I.Prev=D):(A.Next=D,D.Prev=A,I.Prev=z,z.Next=I),u.BottomPt=null,v===h&&(h.FirstLeft!==u&&(u.FirstLeft=h.FirstLeft),u.IsHole=h.IsHole),h.Pts=null,h.BottomPt=null,h.FirstLeft=u;var H=i.OutIdx,ae=o.OutIdx;i.OutIdx=-1,o.OutIdx=-1;for(var te=this.m_ActiveEdges;te!==null;){if(te.OutIdx===ae){te.OutIdx=H,te.Side=i.Side;break}te=te.NextInAEL}h.Idx=u.Idx},e.Clipper.prototype.ReversePolyPtLinks=function(i){if(i!==null){var o,u;o=i;do u=o.Next,o.Next=o.Prev,o.Prev=u,o=u;while(o!==i)}},e.Clipper.SwapSides=function(i,o){var u=i.Side;i.Side=o.Side,o.Side=u},e.Clipper.SwapPolyIndexes=function(i,o){var u=i.OutIdx;i.OutIdx=o.OutIdx,o.OutIdx=u},e.Clipper.prototype.IntersectEdges=function(i,o,u){var h=i.OutIdx>=0,v=o.OutIdx>=0;if(e.use_xyz&&this.SetZ(u,i,o),e.use_lines&&(i.WindDelta===0||o.WindDelta===0)){if(i.WindDelta===0&&o.WindDelta===0)return;i.PolyTyp===o.PolyTyp&&i.WindDelta!==o.WindDelta&&this.m_ClipType===e.ClipType.ctUnion?i.WindDelta===0?v&&(this.AddOutPt(i,u),h&&(i.OutIdx=-1)):h&&(this.AddOutPt(o,u),v&&(o.OutIdx=-1)):i.PolyTyp!==o.PolyTyp&&(i.WindDelta===0&&Math.abs(o.WindCnt)===1&&(this.m_ClipType!==e.ClipType.ctUnion||o.WindCnt2===0)?(this.AddOutPt(i,u),h&&(i.OutIdx=-1)):o.WindDelta===0&&Math.abs(i.WindCnt)===1&&(this.m_ClipType!==e.ClipType.ctUnion||i.WindCnt2===0)&&(this.AddOutPt(o,u),v&&(o.OutIdx=-1)));return}if(i.PolyTyp===o.PolyTyp)if(this.IsEvenOddFillType(i)){var I=i.WindCnt;i.WindCnt=o.WindCnt,o.WindCnt=I}else i.WindCnt+o.WindDelta===0?i.WindCnt=-i.WindCnt:i.WindCnt+=o.WindDelta,o.WindCnt-i.WindDelta===0?o.WindCnt=-o.WindCnt:o.WindCnt-=i.WindDelta;else this.IsEvenOddFillType(o)?i.WindCnt2=i.WindCnt2===0?1:0:i.WindCnt2+=o.WindDelta,this.IsEvenOddFillType(i)?o.WindCnt2=o.WindCnt2===0?1:0:o.WindCnt2-=i.WindDelta;var A,D,z,H;i.PolyTyp===e.PolyType.ptSubject?(A=this.m_SubjFillType,z=this.m_ClipFillType):(A=this.m_ClipFillType,z=this.m_SubjFillType),o.PolyTyp===e.PolyType.ptSubject?(D=this.m_SubjFillType,H=this.m_ClipFillType):(D=this.m_ClipFillType,H=this.m_SubjFillType);var ae,te;switch(A){case e.PolyFillType.pftPositive:ae=i.WindCnt;break;case e.PolyFillType.pftNegative:ae=-i.WindCnt;break;default:ae=Math.abs(i.WindCnt);break}switch(D){case e.PolyFillType.pftPositive:te=o.WindCnt;break;case e.PolyFillType.pftNegative:te=-o.WindCnt;break;default:te=Math.abs(o.WindCnt);break}if(h&&v)ae!==0&&ae!==1||te!==0&&te!==1||i.PolyTyp!==o.PolyTyp&&this.m_ClipType!==e.ClipType.ctXor?this.AddLocalMaxPoly(i,o,u):(this.AddOutPt(i,u),this.AddOutPt(o,u),e.Clipper.SwapSides(i,o),e.Clipper.SwapPolyIndexes(i,o));else if(h)(te===0||te===1)&&(this.AddOutPt(i,u),e.Clipper.SwapSides(i,o),e.Clipper.SwapPolyIndexes(i,o));else if(v)(ae===0||ae===1)&&(this.AddOutPt(o,u),e.Clipper.SwapSides(i,o),e.Clipper.SwapPolyIndexes(i,o));else if((ae===0||ae===1)&&(te===0||te===1)){var ge,Ne;switch(z){case e.PolyFillType.pftPositive:ge=i.WindCnt2;break;case e.PolyFillType.pftNegative:ge=-i.WindCnt2;break;default:ge=Math.abs(i.WindCnt2);break}switch(H){case e.PolyFillType.pftPositive:Ne=o.WindCnt2;break;case e.PolyFillType.pftNegative:Ne=-o.WindCnt2;break;default:Ne=Math.abs(o.WindCnt2);break}if(i.PolyTyp!==o.PolyTyp)this.AddLocalMinPoly(i,o,u);else if(ae===1&&te===1)switch(this.m_ClipType){case e.ClipType.ctIntersection:ge>0&&Ne>0&&this.AddLocalMinPoly(i,o,u);break;case e.ClipType.ctUnion:ge<=0&&Ne<=0&&this.AddLocalMinPoly(i,o,u);break;case e.ClipType.ctDifference:(i.PolyTyp===e.PolyType.ptClip&&ge>0&&Ne>0||i.PolyTyp===e.PolyType.ptSubject&&ge<=0&&Ne<=0)&&this.AddLocalMinPoly(i,o,u);break;case e.ClipType.ctXor:this.AddLocalMinPoly(i,o,u);break}else e.Clipper.SwapSides(i,o)}},e.Clipper.prototype.DeleteFromSEL=function(i){var o=i.PrevInSEL,u=i.NextInSEL;o===null&&u===null&&i!==this.m_SortedEdges||(o!==null?o.NextInSEL=u:this.m_SortedEdges=u,u!==null&&(u.PrevInSEL=o),i.NextInSEL=null,i.PrevInSEL=null)},e.Clipper.prototype.ProcessHorizontals=function(){for(var i={};this.PopEdgeFromSEL(i);)this.ProcessHorizontal(i.v)},e.Clipper.prototype.GetHorzDirection=function(i,o){i.Bot.X<i.Top.X?(o.Left=i.Bot.X,o.Right=i.Top.X,o.Dir=e.Direction.dLeftToRight):(o.Left=i.Top.X,o.Right=i.Bot.X,o.Dir=e.Direction.dRightToLeft)},e.Clipper.prototype.ProcessHorizontal=function(i){var o={Dir:null,Left:null,Right:null};this.GetHorzDirection(i,o);for(var u=o.Dir,h=o.Left,v=o.Right,I=i.WindDelta===0,A=i,D=null;A.NextInLML!==null&&e.ClipperBase.IsHorizontal(A.NextInLML);)A=A.NextInLML;A.NextInLML===null&&(D=this.GetMaximaPair(A));var z=this.m_Maxima;if(z!==null)if(u===e.Direction.dLeftToRight){for(;z!==null&&z.X<=i.Bot.X;)z=z.Next;z!==null&&z.X>=A.Top.X&&(z=null)}else{for(;z.Next!==null&&z.Next.X<i.Bot.X;)z=z.Next;z.X<=A.Top.X&&(z=null)}for(var H=null;;){for(var ae=i===A,te=this.GetNextInAEL(i,u);te!==null;){if(z!==null)if(u===e.Direction.dLeftToRight)for(;z!==null&&z.X<te.Curr.X;)i.OutIdx>=0&&!I&&this.AddOutPt(i,new e.IntPoint2(z.X,i.Bot.Y)),z=z.Next;else for(;z!==null&&z.X>te.Curr.X;)i.OutIdx>=0&&!I&&this.AddOutPt(i,new e.IntPoint2(z.X,i.Bot.Y)),z=z.Prev;if(u===e.Direction.dLeftToRight&&te.Curr.X>v||u===e.Direction.dRightToLeft&&te.Curr.X<h||te.Curr.X===i.Top.X&&i.NextInLML!==null&&te.Dx<i.NextInLML.Dx)break;if(i.OutIdx>=0&&!I){e.use_xyz&&(u===e.Direction.dLeftToRight?this.SetZ(te.Curr,i,te):this.SetZ(te.Curr,te,i)),H=this.AddOutPt(i,te.Curr);for(var ge=this.m_SortedEdges;ge!==null;){if(ge.OutIdx>=0&&this.HorzSegmentsOverlap(i.Bot.X,i.Top.X,ge.Bot.X,ge.Top.X)){var Ne=this.GetLastOutPt(ge);this.AddJoin(Ne,H,ge.Top)}ge=ge.NextInSEL}this.AddGhostJoin(H,i.Bot)}if(te===D&&ae){i.OutIdx>=0&&this.AddLocalMaxPoly(i,D,i.Top),this.DeleteFromAEL(i),this.DeleteFromAEL(D);return}if(u===e.Direction.dLeftToRight){var Xe=new e.IntPoint2(te.Curr.X,i.Curr.Y);this.IntersectEdges(i,te,Xe)}else{var Xe=new e.IntPoint2(te.Curr.X,i.Curr.Y);this.IntersectEdges(te,i,Xe)}var He=this.GetNextInAEL(te,u);this.SwapPositionsInAEL(i,te),te=He}if(i.NextInLML===null||!e.ClipperBase.IsHorizontal(i.NextInLML))break;i=this.UpdateEdgeIntoAEL(i),i.OutIdx>=0&&this.AddOutPt(i,i.Bot),o={Dir:u,Left:h,Right:v},this.GetHorzDirection(i,o),u=o.Dir,h=o.Left,v=o.Right}if(i.OutIdx>=0&&H===null){H=this.GetLastOutPt(i);for(var ge=this.m_SortedEdges;ge!==null;){if(ge.OutIdx>=0&&this.HorzSegmentsOverlap(i.Bot.X,i.Top.X,ge.Bot.X,ge.Top.X)){var Ne=this.GetLastOutPt(ge);this.AddJoin(Ne,H,ge.Top)}ge=ge.NextInSEL}this.AddGhostJoin(H,i.Top)}if(i.NextInLML!==null)if(i.OutIdx>=0){if(H=this.AddOutPt(i,i.Top),i=this.UpdateEdgeIntoAEL(i),i.WindDelta===0)return;var rt=i.PrevInAEL,He=i.NextInAEL;if(rt!==null&&rt.Curr.X===i.Bot.X&&rt.Curr.Y===i.Bot.Y&&rt.WindDelta===0&&rt.OutIdx>=0&&rt.Curr.Y>rt.Top.Y&&e.ClipperBase.SlopesEqual3(i,rt,this.m_UseFullRange)){var Ne=this.AddOutPt(rt,i.Bot);this.AddJoin(H,Ne,i.Top)}else if(He!==null&&He.Curr.X===i.Bot.X&&He.Curr.Y===i.Bot.Y&&He.WindDelta!==0&&He.OutIdx>=0&&He.Curr.Y>He.Top.Y&&e.ClipperBase.SlopesEqual3(i,He,this.m_UseFullRange)){var Ne=this.AddOutPt(He,i.Bot);this.AddJoin(H,Ne,i.Top)}}else i=this.UpdateEdgeIntoAEL(i);else i.OutIdx>=0&&this.AddOutPt(i,i.Top),this.DeleteFromAEL(i)},e.Clipper.prototype.GetNextInAEL=function(i,o){return o===e.Direction.dLeftToRight?i.NextInAEL:i.PrevInAEL},e.Clipper.prototype.IsMinima=function(i){return i!==null&&i.Prev.NextInLML!==i&&i.Next.NextInLML!==i},e.Clipper.prototype.IsMaxima=function(i,o){return i!==null&&i.Top.Y===o&&i.NextInLML===null},e.Clipper.prototype.IsIntermediate=function(i,o){return i.Top.Y===o&&i.NextInLML!==null},e.Clipper.prototype.GetMaximaPair=function(i){return e.IntPoint.op_Equality(i.Next.Top,i.Top)&&i.Next.NextInLML===null?i.Next:e.IntPoint.op_Equality(i.Prev.Top,i.Top)&&i.Prev.NextInLML===null?i.Prev:null},e.Clipper.prototype.GetMaximaPairEx=function(i){var o=this.GetMaximaPair(i);return o===null||o.OutIdx===e.ClipperBase.Skip||o.NextInAEL===o.PrevInAEL&&!e.ClipperBase.IsHorizontal(o)?null:o},e.Clipper.prototype.ProcessIntersections=function(i){if(this.m_ActiveEdges===null)return!0;try{if(this.BuildIntersectList(i),this.m_IntersectList.length===0)return!0;if(this.m_IntersectList.length===1||this.FixupIntersectionOrder())this.ProcessIntersectList();else return!1}catch{this.m_SortedEdges=null,this.m_IntersectList.length=0,e.Error("ProcessIntersections error")}return this.m_SortedEdges=null,!0},e.Clipper.prototype.BuildIntersectList=function(i){if(this.m_ActiveEdges!==null){var o=this.m_ActiveEdges;for(this.m_SortedEdges=o;o!==null;)o.PrevInSEL=o.PrevInAEL,o.NextInSEL=o.NextInAEL,o.Curr.X=e.Clipper.TopX(o,i),o=o.NextInAEL;for(var u=!0;u&&this.m_SortedEdges!==null;){for(u=!1,o=this.m_SortedEdges;o.NextInSEL!==null;){var h=o.NextInSEL,v=new e.IntPoint0;if(o.Curr.X>h.Curr.X){this.IntersectPoint(o,h,v),v.Y<i&&(v=new e.IntPoint2(e.Clipper.TopX(o,i),i));var I=new e.IntersectNode;I.Edge1=o,I.Edge2=h,I.Pt.X=v.X,I.Pt.Y=v.Y,e.use_xyz&&(I.Pt.Z=v.Z),this.m_IntersectList.push(I),this.SwapPositionsInSEL(o,h),u=!0}else o=h}if(o.PrevInSEL!==null)o.PrevInSEL.NextInSEL=null;else break}this.m_SortedEdges=null}},e.Clipper.prototype.EdgesAdjacent=function(i){return i.Edge1.NextInSEL===i.Edge2||i.Edge1.PrevInSEL===i.Edge2},e.Clipper.IntersectNodeSort=function(i,o){return o.Pt.Y-i.Pt.Y},e.Clipper.prototype.FixupIntersectionOrder=function(){this.m_IntersectList.sort(this.m_IntersectNodeComparer),this.CopyAELToSEL();for(var i=this.m_IntersectList.length,o=0;o<i;o++){if(!this.EdgesAdjacent(this.m_IntersectList[o])){for(var u=o+1;u<i&&!this.EdgesAdjacent(this.m_IntersectList[u]);)u++;if(u===i)return!1;var h=this.m_IntersectList[o];this.m_IntersectList[o]=this.m_IntersectList[u],this.m_IntersectList[u]=h}this.SwapPositionsInSEL(this.m_IntersectList[o].Edge1,this.m_IntersectList[o].Edge2)}return!0},e.Clipper.prototype.ProcessIntersectList=function(){for(var i=0,o=this.m_IntersectList.length;i<o;i++){var u=this.m_IntersectList[i];this.IntersectEdges(u.Edge1,u.Edge2,u.Pt),this.SwapPositionsInAEL(u.Edge1,u.Edge2)}this.m_IntersectList.length=0};var rr=function(i){return i<0?Math.ceil(i-.5):Math.round(i)},Gn=function(i){return i<0?Math.ceil(i-.5):Math.floor(i+.5)},Qr=function(i){return i<0?-Math.round(Math.abs(i)):Math.round(i)},Hn=function(i){return i<0?(i-=.5,i<-2147483648?Math.ceil(i):i|0):(i+=.5,i>2147483647?Math.floor(i):i|0)};s.msie?e.Clipper.Round=rr:s.chromium?e.Clipper.Round=Qr:s.safari?e.Clipper.Round=Hn:e.Clipper.Round=Gn,e.Clipper.TopX=function(i,o){return o===i.Top.Y?i.Top.X:i.Bot.X+e.Clipper.Round(i.Dx*(o-i.Bot.Y))},e.Clipper.prototype.IntersectPoint=function(i,o,u){u.X=0,u.Y=0;var h,v;if(i.Dx===o.Dx){u.Y=i.Curr.Y,u.X=e.Clipper.TopX(i,u.Y);return}if(i.Delta.X===0)u.X=i.Bot.X,e.ClipperBase.IsHorizontal(o)?u.Y=o.Bot.Y:(v=o.Bot.Y-o.Bot.X/o.Dx,u.Y=e.Clipper.Round(u.X/o.Dx+v));else if(o.Delta.X===0)u.X=o.Bot.X,e.ClipperBase.IsHorizontal(i)?u.Y=i.Bot.Y:(h=i.Bot.Y-i.Bot.X/i.Dx,u.Y=e.Clipper.Round(u.X/i.Dx+h));else{h=i.Bot.X-i.Bot.Y*i.Dx,v=o.Bot.X-o.Bot.Y*o.Dx;var I=(v-h)/(i.Dx-o.Dx);u.Y=e.Clipper.Round(I),Math.abs(i.Dx)<Math.abs(o.Dx)?u.X=e.Clipper.Round(i.Dx*I+h):u.X=e.Clipper.Round(o.Dx*I+v)}if(u.Y<i.Top.Y||u.Y<o.Top.Y){if(i.Top.Y>o.Top.Y)return u.Y=i.Top.Y,u.X=e.Clipper.TopX(o,i.Top.Y),u.X<i.Top.X;u.Y=o.Top.Y,Math.abs(i.Dx)<Math.abs(o.Dx)?u.X=e.Clipper.TopX(i,u.Y):u.X=e.Clipper.TopX(o,u.Y)}u.Y>i.Curr.Y&&(u.Y=i.Curr.Y,Math.abs(i.Dx)>Math.abs(o.Dx)?u.X=e.Clipper.TopX(o,u.Y):u.X=e.Clipper.TopX(i,u.Y))},e.Clipper.prototype.ProcessEdgesAtTopOfScanbeam=function(i){for(var o=this.m_ActiveEdges;o!==null;){var u=this.IsMaxima(o,i);if(u){var h=this.GetMaximaPairEx(o);u=h===null||!e.ClipperBase.IsHorizontal(h)}if(u){this.StrictlySimple&&this.InsertMaxima(o.Top.X);var v=o.PrevInAEL;this.DoMaxima(o),v===null?o=this.m_ActiveEdges:o=v.NextInAEL}else{if(this.IsIntermediate(o,i)&&e.ClipperBase.IsHorizontal(o.NextInLML)?(o=this.UpdateEdgeIntoAEL(o),o.OutIdx>=0&&this.AddOutPt(o,o.Bot),this.AddEdgeToSEL(o)):(o.Curr.X=e.Clipper.TopX(o,i),o.Curr.Y=i),e.use_xyz&&(o.Top.Y===i?o.Curr.Z=o.Top.Z:o.Bot.Y===i?o.Curr.Z=o.Bot.Z:o.Curr.Z=0),this.StrictlySimple){var v=o.PrevInAEL;if(o.OutIdx>=0&&o.WindDelta!==0&&v!==null&&v.OutIdx>=0&&v.Curr.X===o.Curr.X&&v.WindDelta!==0){var I=new e.IntPoint1(o.Curr);e.use_xyz&&this.SetZ(I,v,o);var A=this.AddOutPt(v,I),D=this.AddOutPt(o,I);this.AddJoin(A,D,I)}}o=o.NextInAEL}}for(this.ProcessHorizontals(),this.m_Maxima=null,o=this.m_ActiveEdges;o!==null;){if(this.IsIntermediate(o,i)){var A=null;o.OutIdx>=0&&(A=this.AddOutPt(o,o.Top)),o=this.UpdateEdgeIntoAEL(o);var v=o.PrevInAEL,z=o.NextInAEL;if(v!==null&&v.Curr.X===o.Bot.X&&v.Curr.Y===o.Bot.Y&&A!==null&&v.OutIdx>=0&&v.Curr.Y===v.Top.Y&&e.ClipperBase.SlopesEqual5(o.Curr,o.Top,v.Curr,v.Top,this.m_UseFullRange)&&o.WindDelta!==0&&v.WindDelta!==0){var D=this.AddOutPt(ePrev2,o.Bot);this.AddJoin(A,D,o.Top)}else if(z!==null&&z.Curr.X===o.Bot.X&&z.Curr.Y===o.Bot.Y&&A!==null&&z.OutIdx>=0&&z.Curr.Y===z.Top.Y&&e.ClipperBase.SlopesEqual5(o.Curr,o.Top,z.Curr,z.Top,this.m_UseFullRange)&&o.WindDelta!==0&&z.WindDelta!==0){var D=this.AddOutPt(z,o.Bot);this.AddJoin(A,D,o.Top)}}o=o.NextInAEL}},e.Clipper.prototype.DoMaxima=function(i){var o=this.GetMaximaPairEx(i);if(o===null){i.OutIdx>=0&&this.AddOutPt(i,i.Top),this.DeleteFromAEL(i);return}for(var u=i.NextInAEL;u!==null&&u!==o;)this.IntersectEdges(i,u,i.Top),this.SwapPositionsInAEL(i,u),u=i.NextInAEL;i.OutIdx===-1&&o.OutIdx===-1?(this.DeleteFromAEL(i),this.DeleteFromAEL(o)):i.OutIdx>=0&&o.OutIdx>=0?(i.OutIdx>=0&&this.AddLocalMaxPoly(i,o,i.Top),this.DeleteFromAEL(i),this.DeleteFromAEL(o)):e.use_lines&&i.WindDelta===0?(i.OutIdx>=0&&(this.AddOutPt(i,i.Top),i.OutIdx=e.ClipperBase.Unassigned),this.DeleteFromAEL(i),o.OutIdx>=0&&(this.AddOutPt(o,i.Top),o.OutIdx=e.ClipperBase.Unassigned),this.DeleteFromAEL(o)):e.Error("DoMaxima error")},e.Clipper.ReversePaths=function(i){for(var o=0,u=i.length;o<u;o++)i[o].reverse()},e.Clipper.Orientation=function(i){return e.Clipper.Area(i)>=0},e.Clipper.prototype.PointCount=function(i){if(i===null)return 0;var o=0,u=i;do o++,u=u.Next;while(u!==i);return o},e.Clipper.prototype.BuildResult=function(i){e.Clear(i);for(var o=0,u=this.m_PolyOuts.length;o<u;o++){var h=this.m_PolyOuts[o];if(h.Pts!==null){var v=h.Pts.Prev,I=this.PointCount(v);if(!(I<2)){for(var A=new Array(I),D=0;D<I;D++)A[D]=v.Pt,v=v.Prev;i.push(A)}}}},e.Clipper.prototype.BuildResult2=function(i){i.Clear();for(var o=0,u=this.m_PolyOuts.length;o<u;o++){var h=this.m_PolyOuts[o],v=this.PointCount(h.Pts);if(!(h.IsOpen&&v<2||!h.IsOpen&&v<3)){this.FixHoleLinkage(h);var I=new e.PolyNode;i.m_AllPolys.push(I),h.PolyNode=I,I.m_polygon.length=v;for(var A=h.Pts.Prev,D=0;D<v;D++)I.m_polygon[D]=A.Pt,A=A.Prev}}for(var o=0,u=this.m_PolyOuts.length;o<u;o++){var h=this.m_PolyOuts[o];h.PolyNode!==null&&(h.IsOpen?(h.PolyNode.IsOpen=!0,i.AddChild(h.PolyNode)):h.FirstLeft!==null&&h.FirstLeft.PolyNode!==null?h.FirstLeft.PolyNode.AddChild(h.PolyNode):i.AddChild(h.PolyNode))}},e.Clipper.prototype.FixupOutPolyline=function(i){for(var o=i.Pts,u=o.Prev;o!==u;)if(o=o.Next,e.IntPoint.op_Equality(o.Pt,o.Prev.Pt)){o===u&&(u=o.Prev);var h=o.Prev;h.Next=o.Next,o.Next.Prev=h,o=h}o===o.Prev&&(i.Pts=null)},e.Clipper.prototype.FixupOutPolygon=function(i){var o=null;i.BottomPt=null;for(var u=i.Pts,h=this.PreserveCollinear||this.StrictlySimple;;){if(u.Prev===u||u.Prev===u.Next){i.Pts=null;return}if(e.IntPoint.op_Equality(u.Pt,u.Next.Pt)||e.IntPoint.op_Equality(u.Pt,u.Prev.Pt)||e.ClipperBase.SlopesEqual4(u.Prev.Pt,u.Pt,u.Next.Pt,this.m_UseFullRange)&&(!h||!this.Pt2IsBetweenPt1AndPt3(u.Prev.Pt,u.Pt,u.Next.Pt)))o=null,u.Prev.Next=u.Next,u.Next.Prev=u.Prev,u=u.Prev;else{if(u===o)break;o===null&&(o=u),u=u.Next}}i.Pts=u},e.Clipper.prototype.DupOutPt=function(i,o){var u=new e.OutPt;return u.Pt.X=i.Pt.X,u.Pt.Y=i.Pt.Y,e.use_xyz&&(u.Pt.Z=i.Pt.Z),u.Idx=i.Idx,o?(u.Next=i.Next,u.Prev=i,i.Next.Prev=u,i.Next=u):(u.Prev=i.Prev,u.Next=i,i.Prev.Next=u,i.Prev=u),u},e.Clipper.prototype.GetOverlap=function(i,o,u,h,v){return i<o?u<h?(v.Left=Math.max(i,u),v.Right=Math.min(o,h)):(v.Left=Math.max(i,h),v.Right=Math.min(o,u)):u<h?(v.Left=Math.max(o,u),v.Right=Math.min(i,h)):(v.Left=Math.max(o,h),v.Right=Math.min(i,u)),v.Left<v.Right},e.Clipper.prototype.JoinHorz=function(i,o,u,h,v,I){var A=i.Pt.X>o.Pt.X?e.Direction.dRightToLeft:e.Direction.dLeftToRight,D=u.Pt.X>h.Pt.X?e.Direction.dRightToLeft:e.Direction.dLeftToRight;if(A===D)return!1;if(A===e.Direction.dLeftToRight){for(;i.Next.Pt.X<=v.X&&i.Next.Pt.X>=i.Pt.X&&i.Next.Pt.Y===v.Y;)i=i.Next;I&&i.Pt.X!==v.X&&(i=i.Next),o=this.DupOutPt(i,!I),e.IntPoint.op_Inequality(o.Pt,v)&&(i=o,i.Pt.X=v.X,i.Pt.Y=v.Y,e.use_xyz&&(i.Pt.Z=v.Z),o=this.DupOutPt(i,!I))}else{for(;i.Next.Pt.X>=v.X&&i.Next.Pt.X<=i.Pt.X&&i.Next.Pt.Y===v.Y;)i=i.Next;!I&&i.Pt.X!==v.X&&(i=i.Next),o=this.DupOutPt(i,I),e.IntPoint.op_Inequality(o.Pt,v)&&(i=o,i.Pt.X=v.X,i.Pt.Y=v.Y,e.use_xyz&&(i.Pt.Z=v.Z),o=this.DupOutPt(i,I))}if(D===e.Direction.dLeftToRight){for(;u.Next.Pt.X<=v.X&&u.Next.Pt.X>=u.Pt.X&&u.Next.Pt.Y===v.Y;)u=u.Next;I&&u.Pt.X!==v.X&&(u=u.Next),h=this.DupOutPt(u,!I),e.IntPoint.op_Inequality(h.Pt,v)&&(u=h,u.Pt.X=v.X,u.Pt.Y=v.Y,e.use_xyz&&(u.Pt.Z=v.Z),h=this.DupOutPt(u,!I))}else{for(;u.Next.Pt.X>=v.X&&u.Next.Pt.X<=u.Pt.X&&u.Next.Pt.Y===v.Y;)u=u.Next;!I&&u.Pt.X!==v.X&&(u=u.Next),h=this.DupOutPt(u,I),e.IntPoint.op_Inequality(h.Pt,v)&&(u=h,u.Pt.X=v.X,u.Pt.Y=v.Y,e.use_xyz&&(u.Pt.Z=v.Z),h=this.DupOutPt(u,I))}return A===e.Direction.dLeftToRight===I?(i.Prev=u,u.Next=i,o.Next=h,h.Prev=o):(i.Next=u,u.Prev=i,o.Prev=h,h.Next=o),!0},e.Clipper.prototype.JoinPoints=function(i,o,u){var h=i.OutPt1,v=new e.OutPt,I=i.OutPt2,A=new e.OutPt,D=i.OutPt1.Pt.Y===i.OffPt.Y;if(D&&e.IntPoint.op_Equality(i.OffPt,i.OutPt1.Pt)&&e.IntPoint.op_Equality(i.OffPt,i.OutPt2.Pt)){if(o!==u)return!1;for(v=i.OutPt1.Next;v!==h&&e.IntPoint.op_Equality(v.Pt,i.OffPt);)v=v.Next;var z=v.Pt.Y>i.OffPt.Y;for(A=i.OutPt2.Next;A!==I&&e.IntPoint.op_Equality(A.Pt,i.OffPt);)A=A.Next;var H=A.Pt.Y>i.OffPt.Y;return z===H?!1:z?(v=this.DupOutPt(h,!1),A=this.DupOutPt(I,!0),h.Prev=I,I.Next=h,v.Next=A,A.Prev=v,i.OutPt1=h,i.OutPt2=v,!0):(v=this.DupOutPt(h,!0),A=this.DupOutPt(I,!1),h.Next=I,I.Prev=h,v.Prev=A,A.Next=v,i.OutPt1=h,i.OutPt2=v,!0)}else if(D){for(v=h;h.Prev.Pt.Y===h.Pt.Y&&h.Prev!==v&&h.Prev!==I;)h=h.Prev;for(;v.Next.Pt.Y===v.Pt.Y&&v.Next!==h&&v.Next!==I;)v=v.Next;if(v.Next===h||v.Next===I)return!1;for(A=I;I.Prev.Pt.Y===I.Pt.Y&&I.Prev!==A&&I.Prev!==v;)I=I.Prev;for(;A.Next.Pt.Y===A.Pt.Y&&A.Next!==I&&A.Next!==h;)A=A.Next;if(A.Next===I||A.Next===h)return!1;var ae={Left:null,Right:null};if(!this.GetOverlap(h.Pt.X,v.Pt.X,I.Pt.X,A.Pt.X,ae))return!1;var te=ae.Left,ge=ae.Right,Ne=new e.IntPoint0,Xe;return h.Pt.X>=te&&h.Pt.X<=ge?(Ne.X=h.Pt.X,Ne.Y=h.Pt.Y,e.use_xyz&&(Ne.Z=h.Pt.Z),Xe=h.Pt.X>v.Pt.X):I.Pt.X>=te&&I.Pt.X<=ge?(Ne.X=I.Pt.X,Ne.Y=I.Pt.Y,e.use_xyz&&(Ne.Z=I.Pt.Z),Xe=I.Pt.X>A.Pt.X):v.Pt.X>=te&&v.Pt.X<=ge?(Ne.X=v.Pt.X,Ne.Y=v.Pt.Y,e.use_xyz&&(Ne.Z=v.Pt.Z),Xe=v.Pt.X>h.Pt.X):(Ne.X=A.Pt.X,Ne.Y=A.Pt.Y,e.use_xyz&&(Ne.Z=A.Pt.Z),Xe=A.Pt.X>I.Pt.X),i.OutPt1=h,i.OutPt2=I,this.JoinHorz(h,v,I,A,Ne,Xe)}else{for(v=h.Next;e.IntPoint.op_Equality(v.Pt,h.Pt)&&v!==h;)v=v.Next;var He=v.Pt.Y>h.Pt.Y||!e.ClipperBase.SlopesEqual4(h.Pt,v.Pt,i.OffPt,this.m_UseFullRange);if(He){for(v=h.Prev;e.IntPoint.op_Equality(v.Pt,h.Pt)&&v!==h;)v=v.Prev;if(v.Pt.Y>h.Pt.Y||!e.ClipperBase.SlopesEqual4(h.Pt,v.Pt,i.OffPt,this.m_UseFullRange))return!1}for(A=I.Next;e.IntPoint.op_Equality(A.Pt,I.Pt)&&A!==I;)A=A.Next;var rt=A.Pt.Y>I.Pt.Y||!e.ClipperBase.SlopesEqual4(I.Pt,A.Pt,i.OffPt,this.m_UseFullRange);if(rt){for(A=I.Prev;e.IntPoint.op_Equality(A.Pt,I.Pt)&&A!==I;)A=A.Prev;if(A.Pt.Y>I.Pt.Y||!e.ClipperBase.SlopesEqual4(I.Pt,A.Pt,i.OffPt,this.m_UseFullRange))return!1}return v===h||A===I||v===A||o===u&&He===rt?!1:He?(v=this.DupOutPt(h,!1),A=this.DupOutPt(I,!0),h.Prev=I,I.Next=h,v.Next=A,A.Prev=v,i.OutPt1=h,i.OutPt2=v,!0):(v=this.DupOutPt(h,!0),A=this.DupOutPt(I,!1),h.Next=I,I.Prev=h,v.Prev=A,A.Next=v,i.OutPt1=h,i.OutPt2=v,!0)}},e.Clipper.GetBounds=function(i){for(var o=0,u=i.length;o<u&&i[o].length===0;)o++;if(o===u)return new e.IntRect(0,0,0,0);var h=new e.IntRect;for(h.left=i[o][0].X,h.right=h.left,h.top=i[o][0].Y,h.bottom=h.top;o<u;o++)for(var v=0,I=i[o].length;v<I;v++)i[o][v].X<h.left?h.left=i[o][v].X:i[o][v].X>h.right&&(h.right=i[o][v].X),i[o][v].Y<h.top?h.top=i[o][v].Y:i[o][v].Y>h.bottom&&(h.bottom=i[o][v].Y);return h},e.Clipper.prototype.GetBounds2=function(i){var o=i,u=new e.IntRect;for(u.left=i.Pt.X,u.right=i.Pt.X,u.top=i.Pt.Y,u.bottom=i.Pt.Y,i=i.Next;i!==o;)i.Pt.X<u.left&&(u.left=i.Pt.X),i.Pt.X>u.right&&(u.right=i.Pt.X),i.Pt.Y<u.top&&(u.top=i.Pt.Y),i.Pt.Y>u.bottom&&(u.bottom=i.Pt.Y),i=i.Next;return u},e.Clipper.PointInPolygon=function(i,o){var u=0,h=o.length;if(h<3)return 0;for(var v=o[0],I=1;I<=h;++I){var A=I===h?o[0]:o[I];if(A.Y===i.Y&&(A.X===i.X||v.Y===i.Y&&A.X>i.X==v.X<i.X))return-1;if(v.Y<i.Y!=A.Y<i.Y){if(v.X>=i.X)if(A.X>i.X)u=1-u;else{var D=(v.X-i.X)*(A.Y-i.Y)-(A.X-i.X)*(v.Y-i.Y);if(D===0)return-1;D>0==A.Y>v.Y&&(u=1-u)}else if(A.X>i.X){var D=(v.X-i.X)*(A.Y-i.Y)-(A.X-i.X)*(v.Y-i.Y);if(D===0)return-1;D>0==A.Y>v.Y&&(u=1-u)}}v=A}return u},e.Clipper.prototype.PointInPolygon=function(i,o){var u=0,h=o,v=i.X,I=i.Y,A=o.Pt.X,D=o.Pt.Y;do{o=o.Next;var z=o.Pt.X,H=o.Pt.Y;if(H===I&&(z===v||D===I&&z>v==A<v))return-1;if(D<I!=H<I){if(A>=v)if(z>v)u=1-u;else{var ae=(A-v)*(H-I)-(z-v)*(D-I);if(ae===0)return-1;ae>0==H>D&&(u=1-u)}else if(z>v){var ae=(A-v)*(H-I)-(z-v)*(D-I);if(ae===0)return-1;ae>0==H>D&&(u=1-u)}}A=z,D=H}while(h!==o);return u},e.Clipper.prototype.Poly2ContainsPoly1=function(i,o){var u=i;do{var h=this.PointInPolygon(u.Pt,o);if(h>=0)return h>0;u=u.Next}while(u!==i);return!0},e.Clipper.prototype.FixupFirstLefts1=function(i,o){for(var u,h,v=0,I=this.m_PolyOuts.length;v<I;v++)u=this.m_PolyOuts[v],h=e.Clipper.ParseFirstLeft(u.FirstLeft),u.Pts!==null&&h===i&&this.Poly2ContainsPoly1(u.Pts,o.Pts)&&(u.FirstLeft=o)},e.Clipper.prototype.FixupFirstLefts2=function(i,o){for(var u=o.FirstLeft,h,v,I=0,A=this.m_PolyOuts.length;I<A;I++)h=this.m_PolyOuts[I],!(h.Pts===null||h===o||h===i)&&(v=e.Clipper.ParseFirstLeft(h.FirstLeft),!(v!==u&&v!==i&&v!==o)&&(this.Poly2ContainsPoly1(h.Pts,i.Pts)?h.FirstLeft=i:this.Poly2ContainsPoly1(h.Pts,o.Pts)?h.FirstLeft=o:(h.FirstLeft===i||h.FirstLeft===o)&&(h.FirstLeft=u)))},e.Clipper.prototype.FixupFirstLefts3=function(i,o){for(var u,h,v=0,I=this.m_PolyOuts.length;v<I;v++)u=this.m_PolyOuts[v],h=e.Clipper.ParseFirstLeft(u.FirstLeft),u.Pts!==null&&h===i&&(u.FirstLeft=o)},e.Clipper.ParseFirstLeft=function(i){for(;i!==null&&i.Pts===null;)i=i.FirstLeft;return i},e.Clipper.prototype.JoinCommonEdges=function(){for(var i=0,o=this.m_Joins.length;i<o;i++){var u=this.m_Joins[i],h=this.GetOutRec(u.OutPt1.Idx),v=this.GetOutRec(u.OutPt2.Idx);if(!(h.Pts===null||v.Pts===null)&&!(h.IsOpen||v.IsOpen)){var I;h===v?I=h:this.OutRec1RightOfOutRec2(h,v)?I=v:this.OutRec1RightOfOutRec2(v,h)?I=h:I=this.GetLowermostRec(h,v),this.JoinPoints(u,h,v)&&(h===v?(h.Pts=u.OutPt1,h.BottomPt=null,v=this.CreateOutRec(),v.Pts=u.OutPt2,this.UpdateOutPtIdxs(v),this.Poly2ContainsPoly1(v.Pts,h.Pts)?(v.IsHole=!h.IsHole,v.FirstLeft=h,this.m_UsingPolyTree&&this.FixupFirstLefts2(v,h),(v.IsHole^this.ReverseSolution)==this.Area$1(v)>0&&this.ReversePolyPtLinks(v.Pts)):this.Poly2ContainsPoly1(h.Pts,v.Pts)?(v.IsHole=h.IsHole,h.IsHole=!v.IsHole,v.FirstLeft=h.FirstLeft,h.FirstLeft=v,this.m_UsingPolyTree&&this.FixupFirstLefts2(h,v),(h.IsHole^this.ReverseSolution)==this.Area$1(h)>0&&this.ReversePolyPtLinks(h.Pts)):(v.IsHole=h.IsHole,v.FirstLeft=h.FirstLeft,this.m_UsingPolyTree&&this.FixupFirstLefts1(h,v))):(v.Pts=null,v.BottomPt=null,v.Idx=h.Idx,h.IsHole=I.IsHole,I===v&&(h.FirstLeft=v.FirstLeft),v.FirstLeft=h,this.m_UsingPolyTree&&this.FixupFirstLefts3(v,h)))}}},e.Clipper.prototype.UpdateOutPtIdxs=function(i){var o=i.Pts;do o.Idx=i.Idx,o=o.Prev;while(o!==i.Pts)},e.Clipper.prototype.DoSimplePolygons=function(){for(var i=0;i<this.m_PolyOuts.length;){var o=this.m_PolyOuts[i++],u=o.Pts;if(!(u===null||o.IsOpen))do{for(var h=u.Next;h!==o.Pts;){if(e.IntPoint.op_Equality(u.Pt,h.Pt)&&h.Next!==u&&h.Prev!==u){var v=u.Prev,I=h.Prev;u.Prev=I,I.Next=u,h.Prev=v,v.Next=h,o.Pts=u;var A=this.CreateOutRec();A.Pts=h,this.UpdateOutPtIdxs(A),this.Poly2ContainsPoly1(A.Pts,o.Pts)?(A.IsHole=!o.IsHole,A.FirstLeft=o,this.m_UsingPolyTree&&this.FixupFirstLefts2(A,o)):this.Poly2ContainsPoly1(o.Pts,A.Pts)?(A.IsHole=o.IsHole,o.IsHole=!A.IsHole,A.FirstLeft=o.FirstLeft,o.FirstLeft=A,this.m_UsingPolyTree&&this.FixupFirstLefts2(o,A)):(A.IsHole=o.IsHole,A.FirstLeft=o.FirstLeft,this.m_UsingPolyTree&&this.FixupFirstLefts1(o,A)),h=u}h=h.Next}u=u.Next}while(u!==o.Pts)}},e.Clipper.Area=function(i){if(!Array.isArray(i))return 0;var o=i.length;if(o<3)return 0;for(var u=0,h=0,v=o-1;h<o;++h)u+=(i[v].X+i[h].X)*(i[v].Y-i[h].Y),v=h;return-u*.5},e.Clipper.prototype.Area=function(i){var o=i;if(i===null)return 0;var u=0;do u=u+(i.Prev.Pt.X+i.Pt.X)*(i.Prev.Pt.Y-i.Pt.Y),i=i.Next;while(i!==o);return u*.5},e.Clipper.prototype.Area$1=function(i){return this.Area(i.Pts)},e.Clipper.SimplifyPolygon=function(i,o){var u=new Array,h=new e.Clipper(0);return h.StrictlySimple=!0,h.AddPath(i,e.PolyType.ptSubject,!0),h.Execute(e.ClipType.ctUnion,u,o,o),u},e.Clipper.SimplifyPolygons=function(i,o){typeof o>"u"&&(o=e.PolyFillType.pftEvenOdd);var u=new Array,h=new e.Clipper(0);return h.StrictlySimple=!0,h.AddPaths(i,e.PolyType.ptSubject,!0),h.Execute(e.ClipType.ctUnion,u,o,o),u},e.Clipper.DistanceSqrd=function(i,o){var u=i.X-o.X,h=i.Y-o.Y;return u*u+h*h},e.Clipper.DistanceFromLineSqrd=function(i,o,u){var h=o.Y-u.Y,v=u.X-o.X,I=h*o.X+v*o.Y;return I=h*i.X+v*i.Y-I,I*I/(h*h+v*v)},e.Clipper.SlopesNearCollinear=function(i,o,u,h){return Math.abs(i.X-o.X)>Math.abs(i.Y-o.Y)?i.X>o.X==i.X<u.X?e.Clipper.DistanceFromLineSqrd(i,o,u)<h:o.X>i.X==o.X<u.X?e.Clipper.DistanceFromLineSqrd(o,i,u)<h:e.Clipper.DistanceFromLineSqrd(u,i,o)<h:i.Y>o.Y==i.Y<u.Y?e.Clipper.DistanceFromLineSqrd(i,o,u)<h:o.Y>i.Y==o.Y<u.Y?e.Clipper.DistanceFromLineSqrd(o,i,u)<h:e.Clipper.DistanceFromLineSqrd(u,i,o)<h},e.Clipper.PointsAreClose=function(i,o,u){var h=i.X-o.X,v=i.Y-o.Y;return h*h+v*v<=u},e.Clipper.ExcludeOp=function(i){var o=i.Prev;return o.Next=i.Next,i.Next.Prev=o,o.Idx=0,o},e.Clipper.CleanPolygon=function(i,o){typeof o>"u"&&(o=1.415);var u=i.length;if(u===0)return new Array;for(var h=new Array(u),v=0;v<u;++v)h[v]=new e.OutPt;for(var v=0;v<u;++v)h[v].Pt=i[v],h[v].Next=h[(v+1)%u],h[v].Next.Prev=h[v],h[v].Idx=0;for(var I=o*o,A=h[0];A.Idx===0&&A.Next!==A.Prev;)e.Clipper.PointsAreClose(A.Pt,A.Prev.Pt,I)?(A=e.Clipper.ExcludeOp(A),u--):e.Clipper.PointsAreClose(A.Prev.Pt,A.Next.Pt,I)?(e.Clipper.ExcludeOp(A.Next),A=e.Clipper.ExcludeOp(A),u-=2):e.Clipper.SlopesNearCollinear(A.Prev.Pt,A.Pt,A.Next.Pt,I)?(A=e.Clipper.ExcludeOp(A),u--):(A.Idx=1,A=A.Next);u<3&&(u=0);for(var D=new Array(u),v=0;v<u;++v)D[v]=new e.IntPoint1(A.Pt),A=A.Next;return h=null,D},e.Clipper.CleanPolygons=function(i,o){for(var u=new Array(i.length),h=0,v=i.length;h<v;h++)u[h]=e.Clipper.CleanPolygon(i[h],o);return u},e.Clipper.Minkowski=function(i,o,u,h){var v=h?1:0,I=i.length,A=o.length,D=new Array;if(u)for(var z=0;z<A;z++){for(var H=new Array(I),ae=0,te=i.length,ge=i[ae];ae<te;ae++,ge=i[ae])H[ae]=new e.IntPoint2(o[z].X+ge.X,o[z].Y+ge.Y);D.push(H)}else for(var z=0;z<A;z++){for(var H=new Array(I),ae=0,te=i.length,ge=i[ae];ae<te;ae++,ge=i[ae])H[ae]=new e.IntPoint2(o[z].X-ge.X,o[z].Y-ge.Y);D.push(H)}for(var Ne=new Array,z=0;z<A-1+v;z++)for(var ae=0;ae<I;ae++){var Xe=new Array;Xe.push(D[z%A][ae%I]),Xe.push(D[(z+1)%A][ae%I]),Xe.push(D[(z+1)%A][(ae+1)%I]),Xe.push(D[z%A][(ae+1)%I]),e.Clipper.Orientation(Xe)||Xe.reverse(),Ne.push(Xe)}return Ne},e.Clipper.MinkowskiSum=function(i,o,u){if(o[0]instanceof Array){for(var v=o,A=new e.Paths,I=new e.Clipper,D=0;D<v.length;++D){var z=e.Clipper.Minkowski(i,v[D],!0,u);if(I.AddPaths(z,e.PolyType.ptSubject,!0),u){var h=e.Clipper.TranslatePath(v[D],i[0]);I.AddPath(h,e.PolyType.ptClip,!0)}}return I.Execute(e.ClipType.ctUnion,A,e.PolyFillType.pftNonZero,e.PolyFillType.pftNonZero),A}else{var h=o,v=e.Clipper.Minkowski(i,h,!0,u),I=new e.Clipper;return I.AddPaths(v,e.PolyType.ptSubject,!0),I.Execute(e.ClipType.ctUnion,v,e.PolyFillType.pftNonZero,e.PolyFillType.pftNonZero),v}},e.Clipper.TranslatePath=function(i,o){for(var u=new e.Path,h=0;h<i.length;h++)u.push(new e.IntPoint2(i[h].X+o.X,i[h].Y+o.Y));return u},e.Clipper.MinkowskiDiff=function(i,o){var u=e.Clipper.Minkowski(i,o,!1,!0),h=new e.Clipper;return h.AddPaths(u,e.PolyType.ptSubject,!0),h.Execute(e.ClipType.ctUnion,u,e.PolyFillType.pftNonZero,e.PolyFillType.pftNonZero),u},e.Clipper.PolyTreeToPaths=function(i){var o=new Array;return e.Clipper.AddPolyNodeToPaths(i,e.Clipper.NodeType.ntAny,o),o},e.Clipper.AddPolyNodeToPaths=function(i,o,u){var h=!0;switch(o){case e.Clipper.NodeType.ntOpen:return;case e.Clipper.NodeType.ntClosed:h=!i.IsOpen;break;default:break}i.m_polygon.length>0&&h&&u.push(i.m_polygon);for(var v=0,I=i.Childs(),A=I.length,D=I[v];v<A;v++,D=I[v])e.Clipper.AddPolyNodeToPaths(D,o,u)},e.Clipper.OpenPathsFromPolyTree=function(i){for(var o=new e.Paths,u=0,h=i.ChildCount();u<h;u++)i.Childs()[u].IsOpen&&o.push(i.Childs()[u].m_polygon);return o},e.Clipper.ClosedPathsFromPolyTree=function(i){var o=new e.Paths;return e.Clipper.AddPolyNodeToPaths(i,e.Clipper.NodeType.ntClosed,o),o},Gt(e.Clipper,e.ClipperBase),e.Clipper.NodeType={ntAny:0,ntOpen:1,ntClosed:2},e.ClipperOffset=function(i,o){typeof i>"u"&&(i=2),typeof o>"u"&&(o=e.ClipperOffset.def_arc_tolerance),this.m_destPolys=new e.Paths,this.m_srcPoly=new e.Path,this.m_destPoly=new e.Path,this.m_normals=new Array,this.m_delta=0,this.m_sinA=0,this.m_sin=0,this.m_cos=0,this.m_miterLim=0,this.m_StepsPerRad=0,this.m_lowest=new e.IntPoint0,this.m_polyNodes=new e.PolyNode,this.MiterLimit=i,this.ArcTolerance=o,this.m_lowest.X=-1},e.ClipperOffset.two_pi=6.28318530717959,e.ClipperOffset.def_arc_tolerance=.25,e.ClipperOffset.prototype.Clear=function(){e.Clear(this.m_polyNodes.Childs()),this.m_lowest.X=-1},e.ClipperOffset.Round=e.Clipper.Round,e.ClipperOffset.prototype.AddPath=function(i,o,u){var h=i.length-1;if(!(h<0)){var v=new e.PolyNode;if(v.m_jointype=o,v.m_endtype=u,u===e.EndType.etClosedLine||u===e.EndType.etClosedPolygon)for(;h>0&&e.IntPoint.op_Equality(i[0],i[h]);)h--;v.m_polygon.push(i[0]);for(var I=0,A=0,D=1;D<=h;D++)e.IntPoint.op_Inequality(v.m_polygon[I],i[D])&&(I++,v.m_polygon.push(i[D]),(i[D].Y>v.m_polygon[A].Y||i[D].Y===v.m_polygon[A].Y&&i[D].X<v.m_polygon[A].X)&&(A=I));if(!(u===e.EndType.etClosedPolygon&&I<2)&&(this.m_polyNodes.AddChild(v),u===e.EndType.etClosedPolygon))if(this.m_lowest.X<0)this.m_lowest=new e.IntPoint2(this.m_polyNodes.ChildCount()-1,A);else{var z=this.m_polyNodes.Childs()[this.m_lowest.X].m_polygon[this.m_lowest.Y];(v.m_polygon[A].Y>z.Y||v.m_polygon[A].Y===z.Y&&v.m_polygon[A].X<z.X)&&(this.m_lowest=new e.IntPoint2(this.m_polyNodes.ChildCount()-1,A))}}},e.ClipperOffset.prototype.AddPaths=function(i,o,u){for(var h=0,v=i.length;h<v;h++)this.AddPath(i[h],o,u)},e.ClipperOffset.prototype.FixOrientations=function(){if(this.m_lowest.X>=0&&!e.Clipper.Orientation(this.m_polyNodes.Childs()[this.m_lowest.X].m_polygon))for(var i=0;i<this.m_polyNodes.ChildCount();i++){var o=this.m_polyNodes.Childs()[i];(o.m_endtype===e.EndType.etClosedPolygon||o.m_endtype===e.EndType.etClosedLine&&e.Clipper.Orientation(o.m_polygon))&&o.m_polygon.reverse()}else for(var i=0;i<this.m_polyNodes.ChildCount();i++){var o=this.m_polyNodes.Childs()[i];o.m_endtype===e.EndType.etClosedLine&&!e.Clipper.Orientation(o.m_polygon)&&o.m_polygon.reverse()}},e.ClipperOffset.GetUnitNormal=function(i,o){var u=o.X-i.X,h=o.Y-i.Y;if(u===0&&h===0)return new e.DoublePoint2(0,0);var v=1/Math.sqrt(u*u+h*h);return u*=v,h*=v,new e.DoublePoint2(h,-u)},e.ClipperOffset.prototype.DoOffset=function(i){if(this.m_destPolys=new Array,this.m_delta=i,e.ClipperBase.near_zero(i)){for(var o=0;o<this.m_polyNodes.ChildCount();o++){var u=this.m_polyNodes.Childs()[o];u.m_endtype===e.EndType.etClosedPolygon&&this.m_destPolys.push(u.m_polygon)}return}this.MiterLimit>2?this.m_miterLim=2/(this.MiterLimit*this.MiterLimit):this.m_miterLim=.5;var h;this.ArcTolerance<=0?h=e.ClipperOffset.def_arc_tolerance:this.ArcTolerance>Math.abs(i)*e.ClipperOffset.def_arc_tolerance?h=Math.abs(i)*e.ClipperOffset.def_arc_tolerance:h=this.ArcTolerance;var v=3.14159265358979/Math.acos(1-h/Math.abs(i));this.m_sin=Math.sin(e.ClipperOffset.two_pi/v),this.m_cos=Math.cos(e.ClipperOffset.two_pi/v),this.m_StepsPerRad=v/e.ClipperOffset.two_pi,i<0&&(this.m_sin=-this.m_sin);for(var o=0;o<this.m_polyNodes.ChildCount();o++){var u=this.m_polyNodes.Childs()[o];this.m_srcPoly=u.m_polygon;var I=this.m_srcPoly.length;if(!(I===0||i<=0&&(I<3||u.m_endtype!==e.EndType.etClosedPolygon))){if(this.m_destPoly=new Array,I===1){if(u.m_jointype===e.JoinType.jtRound)for(var A=1,D=0,z=1;z<=v;z++){this.m_destPoly.push(new e.IntPoint2(e.ClipperOffset.Round(this.m_srcPoly[0].X+A*i),e.ClipperOffset.Round(this.m_srcPoly[0].Y+D*i)));var H=A;A=A*this.m_cos-this.m_sin*D,D=H*this.m_sin+D*this.m_cos}else for(var A=-1,D=-1,z=0;z<4;++z)this.m_destPoly.push(new e.IntPoint2(e.ClipperOffset.Round(this.m_srcPoly[0].X+A*i),e.ClipperOffset.Round(this.m_srcPoly[0].Y+D*i))),A<0?A=1:D<0?D=1:A=-1;this.m_destPolys.push(this.m_destPoly);continue}this.m_normals.length=0;for(var z=0;z<I-1;z++)this.m_normals.push(e.ClipperOffset.GetUnitNormal(this.m_srcPoly[z],this.m_srcPoly[z+1]));if(u.m_endtype===e.EndType.etClosedLine||u.m_endtype===e.EndType.etClosedPolygon?this.m_normals.push(e.ClipperOffset.GetUnitNormal(this.m_srcPoly[I-1],this.m_srcPoly[0])):this.m_normals.push(new e.DoublePoint1(this.m_normals[I-2])),u.m_endtype===e.EndType.etClosedPolygon){for(var ae=I-1,z=0;z<I;z++)ae=this.OffsetPoint(z,ae,u.m_jointype);this.m_destPolys.push(this.m_destPoly)}else if(u.m_endtype===e.EndType.etClosedLine){for(var ae=I-1,z=0;z<I;z++)ae=this.OffsetPoint(z,ae,u.m_jointype);this.m_destPolys.push(this.m_destPoly),this.m_destPoly=new Array;for(var te=this.m_normals[I-1],z=I-1;z>0;z--)this.m_normals[z]=new e.DoublePoint2(-this.m_normals[z-1].X,-this.m_normals[z-1].Y);this.m_normals[0]=new e.DoublePoint2(-te.X,-te.Y),ae=0;for(var z=I-1;z>=0;z--)ae=this.OffsetPoint(z,ae,u.m_jointype);this.m_destPolys.push(this.m_destPoly)}else{for(var ae=0,z=1;z<I-1;++z)ae=this.OffsetPoint(z,ae,u.m_jointype);var ge;if(u.m_endtype===e.EndType.etOpenButt){var z=I-1;ge=new e.IntPoint2(e.ClipperOffset.Round(this.m_srcPoly[z].X+this.m_normals[z].X*i),e.ClipperOffset.Round(this.m_srcPoly[z].Y+this.m_normals[z].Y*i)),this.m_destPoly.push(ge),ge=new e.IntPoint2(e.ClipperOffset.Round(this.m_srcPoly[z].X-this.m_normals[z].X*i),e.ClipperOffset.Round(this.m_srcPoly[z].Y-this.m_normals[z].Y*i)),this.m_destPoly.push(ge)}else{var z=I-1;ae=I-2,this.m_sinA=0,this.m_normals[z]=new e.DoublePoint2(-this.m_normals[z].X,-this.m_normals[z].Y),u.m_endtype===e.EndType.etOpenSquare?this.DoSquare(z,ae):this.DoRound(z,ae)}for(var z=I-1;z>0;z--)this.m_normals[z]=new e.DoublePoint2(-this.m_normals[z-1].X,-this.m_normals[z-1].Y);this.m_normals[0]=new e.DoublePoint2(-this.m_normals[1].X,-this.m_normals[1].Y),ae=I-1;for(var z=ae-1;z>0;--z)ae=this.OffsetPoint(z,ae,u.m_jointype);u.m_endtype===e.EndType.etOpenButt?(ge=new e.IntPoint2(e.ClipperOffset.Round(this.m_srcPoly[0].X-this.m_normals[0].X*i),e.ClipperOffset.Round(this.m_srcPoly[0].Y-this.m_normals[0].Y*i)),this.m_destPoly.push(ge),ge=new e.IntPoint2(e.ClipperOffset.Round(this.m_srcPoly[0].X+this.m_normals[0].X*i),e.ClipperOffset.Round(this.m_srcPoly[0].Y+this.m_normals[0].Y*i)),this.m_destPoly.push(ge)):(ae=1,this.m_sinA=0,u.m_endtype===e.EndType.etOpenSquare?this.DoSquare(0,1):this.DoRound(0,1)),this.m_destPolys.push(this.m_destPoly)}}}},e.ClipperOffset.prototype.Execute=function(){var i=arguments,o=i[0]instanceof e.PolyTree;if(o){var u=i[0],h=i[1];u.Clear(),this.FixOrientations(),this.DoOffset(h);var v=new e.Clipper(0);if(v.AddPaths(this.m_destPolys,e.PolyType.ptSubject,!0),h>0)v.Execute(e.ClipType.ctUnion,u,e.PolyFillType.pftPositive,e.PolyFillType.pftPositive);else{var I=e.Clipper.GetBounds(this.m_destPolys),A=new e.Path;if(A.push(new e.IntPoint2(I.left-10,I.bottom+10)),A.push(new e.IntPoint2(I.right+10,I.bottom+10)),A.push(new e.IntPoint2(I.right+10,I.top-10)),A.push(new e.IntPoint2(I.left-10,I.top-10)),v.AddPath(A,e.PolyType.ptSubject,!0),v.ReverseSolution=!0,v.Execute(e.ClipType.ctUnion,u,e.PolyFillType.pftNegative,e.PolyFillType.pftNegative),u.ChildCount()===1&&u.Childs()[0].ChildCount()>0){var D=u.Childs()[0];u.Childs()[0]=D.Childs()[0],u.Childs()[0].m_Parent=u;for(var z=1;z<D.ChildCount();z++)u.AddChild(D.Childs()[z])}else u.Clear()}}else{var u=i[0],h=i[1];e.Clear(u),this.FixOrientations(),this.DoOffset(h);var v=new e.Clipper(0);if(v.AddPaths(this.m_destPolys,e.PolyType.ptSubject,!0),h>0)v.Execute(e.ClipType.ctUnion,u,e.PolyFillType.pftPositive,e.PolyFillType.pftPositive);else{var I=e.Clipper.GetBounds(this.m_destPolys),A=new e.Path;A.push(new e.IntPoint2(I.left-10,I.bottom+10)),A.push(new e.IntPoint2(I.right+10,I.bottom+10)),A.push(new e.IntPoint2(I.right+10,I.top-10)),A.push(new e.IntPoint2(I.left-10,I.top-10)),v.AddPath(A,e.PolyType.ptSubject,!0),v.ReverseSolution=!0,v.Execute(e.ClipType.ctUnion,u,e.PolyFillType.pftNegative,e.PolyFillType.pftNegative),u.length>0&&u.splice(0,1)}}},e.ClipperOffset.prototype.OffsetPoint=function(i,o,u){if(this.m_sinA=this.m_normals[o].X*this.m_normals[i].Y-this.m_normals[i].X*this.m_normals[o].Y,Math.abs(this.m_sinA*this.m_delta)<1){var h=this.m_normals[o].X*this.m_normals[i].X+this.m_normals[i].Y*this.m_normals[o].Y;if(h>0)return this.m_destPoly.push(new e.IntPoint2(e.ClipperOffset.Round(this.m_srcPoly[i].X+this.m_normals[o].X*this.m_delta),e.ClipperOffset.Round(this.m_srcPoly[i].Y+this.m_normals[o].Y*this.m_delta))),o}else this.m_sinA>1?this.m_sinA=1:this.m_sinA<-1&&(this.m_sinA=-1);if(this.m_sinA*this.m_delta<0)this.m_destPoly.push(new e.IntPoint2(e.ClipperOffset.Round(this.m_srcPoly[i].X+this.m_normals[o].X*this.m_delta),e.ClipperOffset.Round(this.m_srcPoly[i].Y+this.m_normals[o].Y*this.m_delta))),this.m_destPoly.push(new e.IntPoint1(this.m_srcPoly[i])),this.m_destPoly.push(new e.IntPoint2(e.ClipperOffset.Round(this.m_srcPoly[i].X+this.m_normals[i].X*this.m_delta),e.ClipperOffset.Round(this.m_srcPoly[i].Y+this.m_normals[i].Y*this.m_delta)));else switch(u){case e.JoinType.jtMiter:{var v=1+(this.m_normals[i].X*this.m_normals[o].X+this.m_normals[i].Y*this.m_normals[o].Y);v>=this.m_miterLim?this.DoMiter(i,o,v):this.DoSquare(i,o);break}case e.JoinType.jtSquare:this.DoSquare(i,o);break;case e.JoinType.jtRound:this.DoRound(i,o);break}return o=i,o},e.ClipperOffset.prototype.DoSquare=function(i,o){var u=Math.tan(Math.atan2(this.m_sinA,this.m_normals[o].X*this.m_normals[i].X+this.m_normals[o].Y*this.m_normals[i].Y)/4);this.m_destPoly.push(new e.IntPoint2(e.ClipperOffset.Round(this.m_srcPoly[i].X+this.m_delta*(this.m_normals[o].X-this.m_normals[o].Y*u)),e.ClipperOffset.Round(this.m_srcPoly[i].Y+this.m_delta*(this.m_normals[o].Y+this.m_normals[o].X*u)))),this.m_destPoly.push(new e.IntPoint2(e.ClipperOffset.Round(this.m_srcPoly[i].X+this.m_delta*(this.m_normals[i].X+this.m_normals[i].Y*u)),e.ClipperOffset.Round(this.m_srcPoly[i].Y+this.m_delta*(this.m_normals[i].Y-this.m_normals[i].X*u))))},e.ClipperOffset.prototype.DoMiter=function(i,o,u){var h=this.m_delta/u;this.m_destPoly.push(new e.IntPoint2(e.ClipperOffset.Round(this.m_srcPoly[i].X+(this.m_normals[o].X+this.m_normals[i].X)*h),e.ClipperOffset.Round(this.m_srcPoly[i].Y+(this.m_normals[o].Y+this.m_normals[i].Y)*h)))},e.ClipperOffset.prototype.DoRound=function(i,o){for(var u=Math.atan2(this.m_sinA,this.m_normals[o].X*this.m_normals[i].X+this.m_normals[o].Y*this.m_normals[i].Y),h=Math.max(e.Cast_Int32(e.ClipperOffset.Round(this.m_StepsPerRad*Math.abs(u))),1),v=this.m_normals[o].X,I=this.m_normals[o].Y,A,D=0;D<h;++D)this.m_destPoly.push(new e.IntPoint2(e.ClipperOffset.Round(this.m_srcPoly[i].X+v*this.m_delta),e.ClipperOffset.Round(this.m_srcPoly[i].Y+I*this.m_delta))),A=v,v=v*this.m_cos-this.m_sin*I,I=A*this.m_sin+I*this.m_cos;this.m_destPoly.push(new e.IntPoint2(e.ClipperOffset.Round(this.m_srcPoly[i].X+this.m_normals[i].X*this.m_delta),e.ClipperOffset.Round(this.m_srcPoly[i].Y+this.m_normals[i].Y*this.m_delta)))},e.Error=function(i){try{throw new Error(i)}catch(o){alert(o.message)}},e.JS={},e.JS.AreaOfPolygon=function(i,o){return o||(o=1),e.Clipper.Area(i)/(o*o)},e.JS.AreaOfPolygons=function(i,o){o||(o=1);for(var u=0,h=0;h<i.length;h++)u+=e.Clipper.Area(i[h]);return u/(o*o)},e.JS.BoundsOfPath=function(i,o){return e.JS.BoundsOfPaths([i],o)},e.JS.BoundsOfPaths=function(i,o){o||(o=1);var u=e.Clipper.GetBounds(i);return u.left/=o,u.bottom/=o,u.right/=o,u.top/=o,u},e.JS.Clean=function(h,o){if(!(h instanceof Array))return[];var u=h[0]instanceof Array,h=e.JS.Clone(h);if(typeof o!="number"||o===null)return e.Error("Delta is not a number in Clean()."),h;if(h.length===0||h.length===1&&h[0].length===0||o<0)return h;u||(h=[h]);for(var v=h.length,I,A,D,z,H,ae,te,ge=[],Ne=0;Ne<v;Ne++)if(A=h[Ne],I=A.length,I!==0){if(I<3){D=A,ge.push(D);continue}for(D=A,z=o*o,H=A[0],ae=1,te=1;te<I;te++)(A[te].X-H.X)*(A[te].X-H.X)+(A[te].Y-H.Y)*(A[te].Y-H.Y)<=z||(D[ae]=A[te],H=A[te],ae++);H=A[ae-1],(A[0].X-H.X)*(A[0].X-H.X)+(A[0].Y-H.Y)*(A[0].Y-H.Y)<=z&&ae--,ae<I&&D.splice(ae,I-ae),D.length&&ge.push(D)}return!u&&ge.length?ge=ge[0]:!u&&ge.length===0?ge=[]:u&&ge.length===0&&(ge=[[]]),ge},e.JS.Clone=function(i){if(!(i instanceof Array))return[];if(i.length===0)return[];if(i.length===1&&i[0].length===0)return[[]];var o=i[0]instanceof Array;o||(i=[i]);var u=i.length,h,v,I,A,D=new Array(u);for(v=0;v<u;v++){for(h=i[v].length,A=new Array(h),I=0;I<h;I++)A[I]={X:i[v][I].X,Y:i[v][I].Y};D[v]=A}return o||(D=D[0]),D},e.JS.Lighten=function(i,o){if(!(i instanceof Array))return[];if(typeof o!="number"||o===null)return e.Error("Tolerance is not a number in Lighten()."),e.JS.Clone(i);if(i.length===0||i.length===1&&i[0].length===0||o<0)return e.JS.Clone(i);var u=i[0]instanceof Array;u||(i=[i]);var h,v,I,A,D,z,H,ae,te,ge,Ne,Xe,He,rt,wt,$t,Ci,li=i.length,Ft=o*o,mi=[];for(h=0;h<li;h++)if(I=i[h],z=I.length,z!==0){for(A=0;A<1e6;A++){for(D=[],z=I.length,I[z-1].X!==I[0].X||I[z-1].Y!==I[0].Y?(Xe=1,I.push({X:I[0].X,Y:I[0].Y}),z=I.length):Xe=0,Ne=[],v=0;v<z-2;v++)H=I[v],te=I[v+1],ae=I[v+2],$t=H.X,Ci=H.Y,He=ae.X-$t,rt=ae.Y-Ci,(He!==0||rt!==0)&&(wt=((te.X-$t)*He+(te.Y-Ci)*rt)/(He*He+rt*rt),wt>1?($t=ae.X,Ci=ae.Y):wt>0&&($t+=He*wt,Ci+=rt*wt)),He=te.X-$t,rt=te.Y-Ci,ge=He*He+rt*rt,ge<=Ft&&(Ne[v+1]=1,v++);for(D.push({X:I[0].X,Y:I[0].Y}),v=1;v<z-1;v++)Ne[v]||D.push({X:I[v].X,Y:I[v].Y});if(D.push({X:I[z-1].X,Y:I[z-1].Y}),Xe&&I.pop(),Ne.length)I=D;else break}z=D.length,D[z-1].X===D[0].X&&D[z-1].Y===D[0].Y&&D.pop(),D.length>2&&mi.push(D)}return u||(mi=mi[0]),typeof mi>"u"&&(mi=[]),mi},e.JS.PerimeterOfPath=function(i,o,u){if(typeof i>"u")return 0;var h=Math.sqrt,v=0,I,A,D=0,z=0,H=0,ae=0,te=i.length;if(te<2)return 0;for(o&&(i[te]=i[0],te++);--te;)I=i[te],D=I.X,z=I.Y,A=i[te-1],H=A.X,ae=A.Y,v+=h((D-H)*(D-H)+(z-ae)*(z-ae));return o&&i.pop(),v/u},e.JS.PerimeterOfPaths=function(i,o,u){u||(u=1);for(var h=0,v=0;v<i.length;v++)h+=e.JS.PerimeterOfPath(i[v],o,u);return h},e.JS.ScaleDownPath=function(i,o){var u,h;for(o||(o=1),u=i.length;u--;)h=i[u],h.X=h.X/o,h.Y=h.Y/o},e.JS.ScaleDownPaths=function(i,o){var u,h,v;for(o||(o=1),u=i.length;u--;)for(h=i[u].length;h--;)v=i[u][h],v.X=v.X/o,v.Y=v.Y/o},e.JS.ScaleUpPath=function(i,o){var u,h,v=Math.round;for(o||(o=1),u=i.length;u--;)h=i[u],h.X=v(h.X*o),h.Y=v(h.Y*o)},e.JS.ScaleUpPaths=function(i,o){var u,h,v,I=Math.round;for(o||(o=1),u=i.length;u--;)for(h=i[u].length;h--;)v=i[u][h],v.X=I(v.X*o),v.Y=I(v.Y*o)},e.ExPolygons=function(){return[]},e.ExPolygon=function(){this.outer=null,this.holes=null},e.JS.AddOuterPolyNodeToExPolygons=function(i,o){var u=new e.ExPolygon;u.outer=i.Contour();var h=i.Childs(),v=h.length;u.holes=new Array(v);var I,A,D,z,H,ae;for(D=0;D<v;D++)for(I=h[D],u.holes[D]=I.Contour(),z=0,H=I.Childs(),ae=H.length;z<ae;z++)A=H[z],e.JS.AddOuterPolyNodeToExPolygons(A,o);o.push(u)},e.JS.ExPolygonsToPaths=function(i){var o,u,h,v,I=new e.Paths;for(o=0,h=i.length;o<h;o++)for(I.push(i[o].outer),u=0,v=i[o].holes.length;u<v;u++)I.push(i[o].holes[u]);return I},e.JS.PolyTreeToExPolygons=function(i){var o=new e.ExPolygons,u,h,v,I;for(h=0,v=i.Childs(),I=v.length;h<I;h++)u=v[h],e.JS.AddOuterPolyNodeToExPolygons(u,o);return o}})()});var w0={};E_(w0,{InferenceSession:()=>Zo,TRACE:()=>Lr,TRACE_EVENT_BEGIN:()=>ki,TRACE_EVENT_END:()=>Ni,TRACE_FUNC_BEGIN:()=>ti,TRACE_FUNC_END:()=>qt,Tensor:()=>ei,default:()=>nw,env:()=>lt,registerBackend:()=>Ki});async function Vu(e={}){var t=e,r=!!globalThis.window,n=!!globalThis.WorkerGlobalScope,s=n&&self.name?.startsWith("em-pthread");t.mountExternalData=(f,y)=>{f.startsWith("./")&&(f=f.substring(2)),(t.ad||(t.ad=new Map)).set(f,y)},t.unmountExternalData=()=>{delete t.ad,delete t.Yd,delete t.Xd,delete t.be},globalThis.SharedArrayBuffer??new WebAssembly.Memory({initial:0,maximum:0,shared:!0}).buffer.constructor;let l=f=>async(...y)=>{try{if(t.$c)throw Error("Session already started");let $=t.$c={Nd:y[0],errors:[]},b=await f(...y);if(t.$c!==$)throw Error("Session mismatch");t.hd?.flush();let O=$.errors;if(0<O.length){let R=await Promise.all(O);if(R=R.filter(X=>X),0<R.length)throw Error(R.join(`
`))}return b}finally{t.$c=null}};t.jsepInit=(f,y)=>{if(f==="webgpu"){[t.hd,t.Dd,t.Hd,t.jd,t.Gd,t.bc,t.Id,t.Kd,t.Ed,t.Fd,t.Jd]=y;let $=t.hd;t.jsepRegisterBuffer=(b,O,R,X)=>$.registerBuffer(b,O,R,X),t.jsepGetBuffer=b=>$.getBuffer(b),t.jsepCreateDownloader=(b,O,R)=>$.createDownloader(b,O,R),t.jsepOnCreateSession=b=>{$.onCreateSession(b)},t.jsepOnReleaseSession=b=>{$.onReleaseSession(b)},t.jsepOnRunStart=b=>$.onRunStart(b),t.Ld=(b,O)=>{$.upload(b,O)}}else if(f==="webnn"){let $=y[0];[t.Vd,t.vd,t.webnnEnsureTensor,t.wd,t.webnnDownloadTensor,t.Ud,t.webnnEnableTraceEvent]=y.slice(1),t.webnnReleaseTensorId=t.vd,t.webnnUploadTensor=t.wd,t.webnnRegisterMLContext=t.Ud,t.webnnOnRunStart=b=>$.onRunStart(b),t.webnnOnRunEnd=$.onRunEnd.bind($),t.webnnOnReleaseSession=b=>{$.onReleaseSession(b)},t.webnnCreateMLTensorDownloader=(b,O)=>$.createMLTensorDownloader(b,O),t.webnnRegisterMLTensor=(b,O,R,X)=>$.registerMLTensor(b,O,R,X),t.webnnCreateMLContext=b=>$.createMLContext(b),t.webnnRegisterGraphInput=$.registerGraphInput.bind($),t.webnnIsGraphInput=$.isGraphInput.bind($),t.webnnRegisterGraphOutput=$.registerGraphOutput.bind($),t.webnnIsGraphOutput=$.isGraphOutput.bind($),t.webnnCreateTemporaryTensor=$.createTemporaryTensor.bind($),t.webnnIsGraphInputOutputTypeSupported=$.isGraphInputOutputTypeSupported.bind($)}};let a=()=>{let f=y=>(...$)=>{let b=Ft;return $=y(...$),Ft!=b?new Promise((O,R)=>{jn={resolve:O,reject:R}}):$};(()=>{for(let y of["_OrtAppendExecutionProvider","_OrtCreateSession","_OrtRun","_OrtRunWithBinding","_OrtBindInput"])t[y]=f(t[y])})(),l!==void 0&&(t._OrtRun=l(t._OrtRun),t._OrtRunWithBinding=l(t._OrtRunWithBinding)),a=void 0};t.asyncInit=()=>{a?.()};var d,p,c=(f,y)=>{throw y},g=Qt.url,_="";if(r||n){try{_=new URL(".",g).href}catch{}n&&(p=f=>{var y=new XMLHttpRequest;return y.open("GET",f,!1),y.responseType="arraybuffer",y.send(null),new Uint8Array(y.response)}),d=async f=>{if(U(f))return new Promise(($,b)=>{var O=new XMLHttpRequest;O.open("GET",f,!0),O.responseType="arraybuffer",O.onload=()=>{O.status==200||O.status==0&&O.response?$(O.response):b(O.status)},O.onerror=b,O.send(null)});var y=await fetch(f,{credentials:"same-origin"});if(y.ok)return y.arrayBuffer();throw Error(y.status+" : "+y.url)}}var w,C,x,S,N,E,T=console.log.bind(console),B=console.error.bind(console),L=T,M=B,F=!1,U=f=>f.startsWith("file://");function k(){Tt.buffer!=ye.buffer&&ve()}if(s){let f=function(y){try{var $=y.data,b=$.Vc;if(b==="load"){let O=[];self.onmessage=R=>O.push(R),E=()=>{postMessage({Vc:"loaded"});for(let R of O)f(R);self.onmessage=f};for(let R of $.Ad)t[R]&&!t[R].proxy||(t[R]=(...X)=>{postMessage({Vc:"callHandler",yd:R,args:X})},R=="print"&&(L=t[R]),R=="printErr"&&(M=t[R]));Tt=$.Rd,ve(),C=$.Sd,et(),on()}else if(b==="run"){(function(O){var R=(k(),Y)[O+52>>>2>>>0];O=(k(),Y)[O+56>>>2>>>0],fl(R,R-O),Fe(R)})($.Uc),es($.Uc,0,0,1,0,0),Ot(),ae($.Uc),oe||(al(),oe=!0);try{Di($.Pd,$.ed)}catch(O){if(O!="unwind")throw O}}else $.target!=="setimmediate"&&(b==="checkMailbox"?oe&&te():b&&(M(`worker: received unknown command ${b}`),M($)))}catch(O){throw ll(),O}};var re=f,oe=!1;self.onunhandledrejection=y=>{throw y.reason||y},self.onmessage=f}var ye,fe,ce,$e,q,Y,Ie,Te,be,ke,ne,Se=!1;function ve(){var f=Tt.buffer;t.HEAP8=ye=new Int8Array(f),ce=new Int16Array(f),t.HEAPU8=fe=new Uint8Array(f),$e=new Uint16Array(f),t.HEAP32=q=new Int32Array(f),t.HEAPU32=Y=new Uint32Array(f),Ie=new Float32Array(f),Te=new Float64Array(f),be=new BigInt64Array(f),ke=new BigUint64Array(f)}function me(){Se=!0,s?E():gi.ub()}function Ue(f){throw M(f="Aborted("+f+")"),F=!0,f=new WebAssembly.RuntimeError(f+". Build with -sASSERTIONS for more info."),N?.(f),f}function st(){return{a:{ma:My,hb:Ly,g:ie,J:K,f:le,o:ue,i:Q,$:pe,b:xe,S:Ee,Ha:Le,n:ze,aa:zr,Ya:Fr,Da:Ur,Fa:qr,Za:Wr,Wa:Xr,Pa:Yr,Va:Gr,ka:Hr,Ea:Vr,Ba:jr,Xa:Kr,Ca:Zr,cb:zi,fa:Fn,wa:Un,ua:yt,ea:Xn,N:Yn,H:We,va:Gn,_:I,xa:A,Sa:D,za:ge,Ia:Xe,sa:He,ga:rt,Ra:ae,$a:wt,Q:K0,r:ty,c:cr,ib:iy,y:ry,M:ny,D:sy,l:oy,s:Wa,jb:ay,I:ly,R:uy,j:dy,u:py,q:cy,k:fy,Ma:hy,Na:my,Oa:gy,Ka:Ha,La:Va,ta:ja,eb:_y,bb:by,v:xy,ba:$y,ha:Cy,ab:vy,V:Iy,_a:Ty,Aa:Sy,F:yy,U:Py,la:nn,ya:Ay,gb:Ey,fb:Oy,Ta:Qa,Ua:el,Ga:ni,T:tl,Ja:il,ja:rl,Qa:nl,ia:sl,lb:v_,na:h_,mb:__,oa:f_,G:i_,e:Fy,t:Dy,w:Ry,B:Ky,nb:d_,Z:u_,x:Wy,pa:p_,X:m_,ca:l_,ob:a_,pb:o_,O:Zy,qb:n_,qa:s_,rb:r_,L:e_,Y:c_,d:zy,A:qy,m:Uy,kb:w_,p:Yy,z:Gy,C:Xy,E:Hy,K:Jy,ra:t_,P:g_,da:Qy,W:y_,sb:jy,tb:Vy,h:Ny,a:Tt,db:ri}}}async function et(){function f(b,O){var R=gi=b.exports;b={};for(let[X,J]of Object.entries(R))typeof J=="function"?(R=Ci(J),b[X]=R):b[X]=J;return gi=b,gi=(function(){var X=gi,J=_e=>De=>_e(De)>>>0,he=_e=>()=>_e()>>>0;return(X=Object.assign({},X)).vb=J(X.vb),X.Zb=he(X.Zb),X.$b=J(X.$b),X.nc=J(X.nc),X.oc=he(X.oc),X.sc=J(X.sc),X})(),pi.push(gi.ac),ol=(b=gi).vb,al=b.wb,t._OrtInit=b.xb,t._OrtGetLastError=b.yb,t._OrtCreateSessionOptions=b.zb,t._OrtAppendExecutionProvider=b.Ab,t._OrtAddFreeDimensionOverride=b.Bb,t._OrtAddSessionConfigEntry=b.Cb,t._OrtReleaseSessionOptions=b.Db,t._OrtCreateSession=b.Eb,t._OrtReleaseSession=b.Fb,t._OrtGetInputOutputCount=b.Gb,t._OrtGetInputOutputMetadata=b.Hb,t._OrtFree=b.Ib,t._OrtCreateTensor=b.Jb,t._OrtGetTensorData=b.Kb,t._OrtReleaseTensor=b.Lb,t._OrtCreateRunOptions=b.Mb,t._OrtAddRunConfigEntry=b.Nb,t._OrtReleaseRunOptions=b.Ob,t._OrtCreateBinding=b.Pb,t._OrtBindInput=b.Qb,t._OrtBindOutput=b.Rb,t._OrtClearBoundOutputs=b.Sb,t._OrtReleaseBinding=b.Tb,t._OrtRunWithBinding=b.Ub,t._OrtRun=b.Vb,t._OrtEndProfiling=b.Wb,t._JsepOutput=b.Xb,t._JsepGetNodeName=b.Yb,sn=b.Zb,ui=t._free=b._b,mr=t._malloc=b.$b,es=b.cc,ll=b.dc,ul=b.ec,dl=b.fc,ts=b.gc,pl=b.hc,cl=b.ic,Ye=b.jc,gr=b.kc,fl=b.lc,Fe=b.mc,is=b.nc,qe=b.oc,hl=b.pc,rs=b.qc,ml=b.rc,gl=b.sc,yl=b.tc,ns=b.uc,_l=b.vc,vl=b.wc,wl=b.xc,bl=b.yc,xl=b.zc,$l=b.Ac,Cl=b.Bc,Il=b.Cc,Tl=b.Dc,Sl=b.Ec,Pl=b.Fc,El=b.Gc,Al=b.Hc,Ol=b.Ic,kl=b.Jc,Nl=b.Kc,Bl=b.Lc,Ll=b.Mc,Ml=b.Nc,Rl=b.Oc,Dl=b.Pc,zl=b.Qc,Fl=b.Sc,Ul=b.Tc,ql=b.cd,Wl=b.dd,Xl=b.id,Yl=b.nd,Gl=b.od,Hl=b.pd,Vl=b.qd,jl=b.rd,Kl=b.sd,Zl=b.td,Jl=b.ud,Ql=b.zd,eu=b.Zd,tu=b._d,iu=b.$d,ru=b.ae,C=O,gi}var y,$=st();return t.instantiateWasm?new Promise(b=>{t.instantiateWasm($,(O,R)=>{b(f(O,R))})}):s?f(new WebAssembly.Instance(C,st()),C):(ne??=t.locateFile?t.locateFile?t.locateFile("ort-wasm-simd-threaded.jsep.wasm",_):_+"ort-wasm-simd-threaded.jsep.wasm":new URL("ort-wasm-simd-threaded.jsep.wasm",Qt.url).href,y=await(async function(b){var O=ne;if(!w&&!U(O))try{var R=fetch(O,{credentials:"same-origin"});return await WebAssembly.instantiateStreaming(R,b)}catch(X){M(`wasm streaming compile failed: ${X}`),M("falling back to ArrayBuffer instantiation")}return(async function(X,J){try{var he=await(async function(_e){if(!w)try{var De=await d(_e);return new Uint8Array(De)}catch{}if(_e==ne&&w)_e=new Uint8Array(w);else{if(!p)throw"both async and sync fetching of the wasm failed";_e=p(_e)}return _e})(X);return await WebAssembly.instantiate(he,J)}catch(_e){M(`failed to asynchronously prepare wasm: ${_e}`),Ue(_e)}})(O,b)})($),f(y.instance,y.module))}class it{name="ExitStatus";constructor(y){this.message=`Program terminated with exit(${y})`,this.status=y}}var Ge=f=>{f.terminate(),f.onmessage=()=>{}},Be=[],Je=0,_t=null,Xt=f=>{xt.length==0&&(si(),xi(xt[0]));var y=xt.pop();if(!y)return 6;zt.push(y),At[f.Uc]=y,y.Uc=f.Uc;var $={Vc:"run",Pd:f.Od,ed:f.ed,Uc:f.Uc};return y.postMessage($,f.md),0},vt=0,Qe=(f,y,...$)=>{var b,O=16*$.length,R=qe(),X=is(O),J=X>>>3;for(b of $)typeof b=="bigint"?((k(),be)[J++>>>0]=1n,(k(),be)[J++>>>0]=b):((k(),be)[J++>>>0]=0n,(k(),Te)[J++>>>0]=b);return f=ul(f,0,O,X,y),Fe(R),f};function ri(f){if(s)return Qe(0,1,f);if(x=f,!(0<vt)){for(var y of zt)Ge(y);for(y of xt)Ge(y);xt=[],zt=[],At={},F=!0}c(0,new it(f))}function Et(f){if(s)return Qe(1,0,f);ni(f)}var ni=f=>{if(x=f,s)throw Et(f),"unwind";ri(f)},xt=[],zt=[],pi=[],At={},ci=f=>{var y=f.Uc;delete At[y],xt.push(f),zt.splice(zt.indexOf(f),1),f.Uc=0,dl(y)};function Ot(){pi.forEach(f=>f())}var xi=f=>new Promise(y=>{f.onmessage=O=>{var R=O.data;if(O=R.Vc,R.bd&&R.bd!=sn()){var X=At[R.bd];X?X.postMessage(R,R.md):M(`Internal error! Worker sent a message "${O}" to target pthread ${R.bd}, but that thread no longer exists!`)}else O==="checkMailbox"?te():O==="spawnThread"?Xt(R):O==="cleanupThread"?z(()=>{ci(At[R.Qd])}):O==="loaded"?(f.loaded=!0,y(f)):R.target==="setimmediate"?f.postMessage(R):O==="uncaughtException"?f.onerror(R.error):O==="callHandler"?t[R.yd](...R.args):O&&M(`worker sent an unknown command ${O}`)},f.onerror=O=>{throw M(`worker sent an error! ${O.filename}:${O.lineno}: ${O.message}`),O};var $,b=[];for($ of[])t.propertyIsEnumerable($)&&b.push($);f.postMessage({Vc:"load",Ad:b,Rd:Tt,Sd:C})});function si(){var f=new Worker((()=>{let y=URL;return Qt.url>"file:"&&Qt.url<"file;"?new y("ort.bundle.min.mjs",Qt.url):new URL(Qt.url)})(),{type:"module",workerData:"em-pthread",name:"em-pthread"});xt.push(f)}var Tt,Di=(f,y)=>{vt=0,f=ns(f,y),0<vt?x=f:ts(f)},m=[],W=0;function ie(f){var y=new j(f>>>=0);return(k(),ye)[y.Wc+12>>>0]==0&&(P(y,!0),W--),G(y,!1),m.push(y),gl(f)}var ee=0,K=()=>{Ye(0,0);var f=m.pop();hl(f.gd),ee=0};function P(f,y){y=y?1:0,(k(),ye)[f.Wc+12>>>0]=y}function G(f,y){y=y?1:0,(k(),ye)[f.Wc+13>>>0]=y}class j{constructor(y){this.gd=y,this.Wc=y-24}}var se=f=>{var y=ee;if(!y)return gr(0),0;var $=new j(y);(k(),Y)[$.Wc+16>>>2>>>0]=y;var b=(k(),Y)[$.Wc+4>>>2>>>0];if(!b)return gr(0),y;for(var O of f){if(O===0||O===b)break;if(ml(O,b,$.Wc+16))return gr(O),y}return gr(b),y};function le(){return se([])}function ue(f){return se([f>>>0])}function Q(f,y,$,b){return se([f>>>0,y>>>0,$>>>0,b>>>0])}var pe=()=>{var f=m.pop();f||Ue("no exception to throw");var y=f.gd;throw(k(),ye)[f.Wc+13>>>0]==0&&(m.push(f),G(f,!0),P(f,!1),W++),rs(y),ee=y};function xe(f,y,$){var b=new j(f>>>=0);throw y>>>=0,$>>>=0,(k(),Y)[b.Wc+16>>>2>>>0]=0,(k(),Y)[b.Wc+4>>>2>>>0]=y,(k(),Y)[b.Wc+8>>>2>>>0]=$,rs(f),W++,ee=f}var Ee=()=>W;function Ae(f,y,$,b){return s?Qe(2,1,f,y,$,b):Le(f,y,$,b)}function Le(f,y,$,b){if(f>>>=0,y>>>=0,$>>>=0,b>>>=0,!globalThis.SharedArrayBuffer)return 6;var O=[];return s&&O.length===0?Ae(f,y,$,b):(f={Od:$,Uc:f,ed:b,md:O},s?(f.Vc="spawnThread",postMessage(f,O),0):Xt(f))}function ze(f){throw ee||=f>>>0,ee}var kt=globalThis.TextDecoder&&new TextDecoder,oi=(f,y,$,b)=>{if($=y+$,b)return $;for(;f[y]&&!(y>=$);)++y;return y},ai=(f,y=0,$,b)=>{if(16<($=oi(f,y>>>=0,$,b))-y&&f.buffer&&kt)return kt.decode(f.buffer instanceof ArrayBuffer?f.subarray(y,$):f.slice(y,$));for(b="";y<$;){var O=f[y++];if(128&O){var R=63&f[y++];if((224&O)==192)b+=String.fromCharCode((31&O)<<6|R);else{var X=63&f[y++];65536>(O=(240&O)==224?(15&O)<<12|R<<6|X:(7&O)<<18|R<<12|X<<6|63&f[y++])?b+=String.fromCharCode(O):(O-=65536,b+=String.fromCharCode(55296|O>>10,56320|1023&O))}}else b+=String.fromCharCode(O)}return b},pt=(f,y,$)=>(f>>>=0)?ai((k(),fe),f,y,$):"";function zr(f,y,$){return s?Qe(3,1,f,y,$):0}function Fr(f,y){if(s)return Qe(4,1,f,y)}function Ur(f,y){if(s)return Qe(5,1,f,y)}function qr(f,y,$){if(s)return Qe(6,1,f,y,$)}function Wr(f,y,$){return s?Qe(7,1,f,y,$):0}function Xr(f,y){if(s)return Qe(8,1,f,y)}function Yr(f,y,$){if(s)return Qe(9,1,f,y,$)}function Gr(f,y,$,b){if(s)return Qe(10,1,f,y,$,b)}function Hr(f,y,$,b){if(s)return Qe(11,1,f,y,$,b)}function Vr(f,y,$,b){if(s)return Qe(12,1,f,y,$,b)}function jr(f){if(s)return Qe(13,1,f)}function Kr(f,y){if(s)return Qe(14,1,f,y)}function Zr(f,y,$){if(s)return Qe(15,1,f,y,$)}var zi=()=>Ue(""),Nt=f=>{f>>>=0;for(var y="";;){var $=(k(),fe)[f++>>>0];if(!$)return y;y+=String.fromCharCode($)}},dr={},pr={},zn={},$i=class extends Error{constructor(f){super(f),this.name="BindingError"}};function Yt(f,y,$={}){return(function(b,O,R={}){var X=O.name;if(!b)throw new $i(`type "${X}" must have a positive integer typeid pointer`);if(pr.hasOwnProperty(b)){if(R.Bd)return;throw new $i(`Cannot register type '${X}' twice`)}pr[b]=O,delete zn[b],dr.hasOwnProperty(b)&&(O=dr[b],delete dr[b],O.forEach(J=>J()))})(f,y,$)}var fi=(f,y,$)=>{switch(y){case 1:return $?b=>(k(),ye)[b>>>0]:b=>(k(),fe)[b>>>0];case 2:return $?b=>(k(),ce)[b>>>1>>>0]:b=>(k(),$e)[b>>>1>>>0];case 4:return $?b=>(k(),q)[b>>>2>>>0]:b=>(k(),Y)[b>>>2>>>0];case 8:return $?b=>(k(),be)[b>>>3>>>0]:b=>(k(),ke)[b>>>3>>>0];default:throw new TypeError(`invalid integer width (${y}): ${f}`)}};function Fn(f,y,$,b,O){f>>>=0,$>>>=0,y=Nt(y>>>0);let R=X=>X;if(b=b===0n){let X=8*$;R=J=>BigInt.asUintN(X,J),O=R(O)}Yt(f,{name:y,Rc:R,Yc:(X,J)=>(typeof J=="number"&&(J=BigInt(J)),J),Xc:fi(y,$,!b),Zc:null})}function Un(f,y,$,b){Yt(f>>>=0,{name:y=Nt(y>>>0),Rc:function(O){return!!O},Yc:function(O,R){return R?$:b},Xc:function(O){return this.Rc((k(),fe)[O>>>0])},Zc:null})}var Jr=[],hi=[0,1,,1,null,1,!0,1,!1,1];function cr(f){9<(f>>>=0)&&--hi[f+1]===0&&(hi[f]=void 0,Jr.push(f))}var St=f=>{if(!f)throw new $i(`Cannot use deleted val. handle = ${f}`);return hi[f]},Bt=f=>{switch(f){case void 0:return 2;case null:return 4;case!0:return 6;case!1:return 8;default:let y=Jr.pop()||hi.length;return hi[y]=f,hi[y+1]=1,y}};function fr(f){return this.Rc((k(),Y)[f>>>2>>>0])}var qn={name:"emscripten::val",Rc:f=>{var y=St(f);return cr(f),y},Yc:(f,y)=>Bt(y),Xc:fr,Zc:null};function yt(f){return Yt(f>>>0,qn)}var Wn=(f,y)=>{switch(y){case 4:return function($){return this.Rc((k(),Ie)[$>>>2>>>0])};case 8:return function($){return this.Rc((k(),Te)[$>>>3>>>0])};default:throw new TypeError(`invalid float width (${y}): ${f}`)}};function Xn(f,y,$){$>>>=0,Yt(f>>>=0,{name:y=Nt(y>>>0),Rc:b=>b,Yc:(b,O)=>O,Xc:Wn(y,$),Zc:null})}function Yn(f,y,$,b,O){f>>>=0,$>>>=0,y=Nt(y>>>0);let R=J=>J;if(b===0){var X=32-8*$;R=J=>J<<X>>>X,O=R(O)}Yt(f,{name:y,Rc:R,Yc:(J,he)=>he,Xc:fi(y,$,b!==0),Zc:null})}function We(f,y,$){function b(R){var X=(k(),Y)[R>>>2>>>0];return R=(k(),Y)[R+4>>>2>>>0],new O((k(),ye).buffer,R,X)}var O=[Int8Array,Uint8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array][y];Yt(f>>>=0,{name:$=Nt($>>>0),Rc:b,Xc:b},{Bd:!0})}var Gt=(f,y,$)=>{var b=(k(),fe);if(y>>>=0,0<$){var O=y;$=y+$-1;for(var R=0;R<f.length;++R){var X=f.codePointAt(R);if(127>=X){if(y>=$)break;b[y++>>>0]=X}else if(2047>=X){if(y+1>=$)break;b[y++>>>0]=192|X>>6,b[y++>>>0]=128|63&X}else if(65535>=X){if(y+2>=$)break;b[y++>>>0]=224|X>>12,b[y++>>>0]=128|X>>6&63,b[y++>>>0]=128|63&X}else{if(y+3>=$)break;b[y++>>>0]=240|X>>18,b[y++>>>0]=128|X>>12&63,b[y++>>>0]=128|X>>6&63,b[y++>>>0]=128|63&X,R++}}b[y>>>0]=0,f=y-O}else f=0;return f},rr=f=>{for(var y=0,$=0;$<f.length;++$){var b=f.charCodeAt($);127>=b?y++:2047>=b?y+=2:55296<=b&&57343>=b?(y+=4,++$):y+=3}return y};function Gn(f,y){Yt(f>>>=0,{name:y=Nt(y>>>0),Rc($){var b=(k(),Y)[$>>>2>>>0];return b=pt($+4,b,!0),ui($),b},Yc($,b){b instanceof ArrayBuffer&&(b=new Uint8Array(b));var O=typeof b=="string";if(!(O||ArrayBuffer.isView(b)&&b.BYTES_PER_ELEMENT==1))throw new $i("Cannot pass non-string to std::string");var R=O?rr(b):b.length,X=mr(4+R+1),J=X+4;return(k(),Y)[X>>>2>>>0]=R,O?Gt(b,J,R+1):(k(),fe).set(b,J>>>0),$!==null&&$.push(ui,X),X},Xc:fr,Zc($){ui($)}})}var Qr=globalThis.TextDecoder?new TextDecoder("utf-16le"):void 0,Hn=(f,y,$)=>{if(f>>>=1,16<(y=oi((k(),$e),f,y/2,$))-f&&Qr)return Qr.decode((k(),$e).slice(f,y));for($="";f<y;++f){var b=(k(),$e)[f>>>0];$+=String.fromCharCode(b)}return $},i=(f,y,$)=>{if($??=2147483647,2>$)return 0;var b=y;$=($-=2)<2*f.length?$/2:f.length;for(var O=0;O<$;++O){var R=f.charCodeAt(O);(k(),ce)[y>>>1>>>0]=R,y+=2}return(k(),ce)[y>>>1>>>0]=0,y-b},o=f=>2*f.length,u=(f,y,$)=>{var b="";f>>>=2;for(var O=0;!(O>=y/4);O++){var R=(k(),Y)[f+O>>>0];if(!R&&!$)break;b+=String.fromCodePoint(R)}return b},h=(f,y,$)=>{if(y>>>=0,$??=2147483647,4>$)return 0;var b=y;$=b+$-4;for(var O=0;O<f.length;++O){var R=f.codePointAt(O);if(65535<R&&O++,(k(),q)[y>>>2>>>0]=R,(y+=4)+4>$)break}return(k(),q)[y>>>2>>>0]=0,y-b},v=f=>{for(var y=0,$=0;$<f.length;++$)65535<f.codePointAt($)&&$++,y+=4;return y};function I(f,y,$){if(f>>>=0,y>>>=0,$=Nt($>>>=0),y===2)var b=Hn,O=i,R=o;else b=u,O=h,R=v;Yt(f,{name:$,Rc:X=>{var J=(k(),Y)[X>>>2>>>0];return J=b(X+4,J*y,!0),ui(X),J},Yc:(X,J)=>{if(typeof J!="string")throw new $i(`Cannot pass non-string to C++ string type ${$}`);var he=R(J),_e=mr(4+he+y);return(k(),Y)[_e>>>2>>>0]=he/y,O(J,_e+4,he+y),X!==null&&X.push(ui,_e),_e},Xc:fr,Zc(X){ui(X)}})}function A(f,y){Yt(f>>>=0,{Cd:!0,name:y=Nt(y>>>0),Rc:()=>{},Yc:()=>{}})}function D(f){es(f>>>0,!n,1,!r,131072,!1),Ot()}var z=f=>{if(!F)try{if(f(),!(0<vt))try{s?sn()&&ts(x):ni(x)}catch(y){y instanceof it||y=="unwind"||c(0,y)}}catch(y){y instanceof it||y=="unwind"||c(0,y)}},H=!Atomics.waitAsync||globalThis.navigator?.userAgent&&91>Number((navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./)||[])[2]);function ae(f){f>>>=0,H||(Atomics.waitAsync((k(),q),f>>>2,f).value.then(te),f+=128,Atomics.store((k(),q),f>>>2,1))}var te=()=>z(()=>{var f=sn();f&&(ae(f),cl())});function ge(f,y){(f>>>=0)==y>>>0?setTimeout(te):s?postMessage({bd:f,Vc:"checkMailbox"}):(f=At[f])&&f.postMessage({Vc:"checkMailbox"})}var Ne=[];function Xe(f,y,$,b,O){for(y>>>=0,O>>>=0,Ne.length=0,$=O>>>3,b=O+b>>>3;$<b;){var R;R=(k(),be)[$++>>>0]?(k(),be)[$++>>>0]:(k(),Te)[$++>>>0],Ne.push(R)}return(y?ss[y]:By[f])(...Ne)}var He=()=>{vt=0};function rt(f){f>>>=0,s?postMessage({Vc:"cleanupThread",Qd:f}):ci(At[f])}function wt(f){}var $t=f=>{try{f()}catch(y){Ue(y)}};function Ci(f){var y=(...$)=>{en.push(f);try{return f(...$)}finally{F||(en.pop(),Ft&&li===1&&en.length===0&&(li=0,vt+=1,$t(tu),typeof Fibers<"u"&&Fibers.de()))}};return Ua.set(f,y),y}var li=0,Ft=null,mi=0,en=[],Vn=new Map,Fa=new Map,Ua=new Map,V0=0,jn=null,j0=[],qa=f=>(function(y){if(!F){if(li===0){var $=!1,b=!1;y((O=0)=>{if(!F&&(mi=O,$=!0,b)){li=2,$t(()=>iu(Ft)),typeof MainLoop<"u"&&MainLoop.xd&&MainLoop.resume(),O=!1;try{var R=(function(){var he=(k(),q)[Ft+8>>>2>>>0];return he=Fa.get(he),he=Ua.get(he),--vt,he()})()}catch(he){R=he,O=!0}var X=!1;if(!Ft){var J=jn;J&&(jn=null,(O?J.reject:J.resolve)(R),X=!0)}if(O&&!X)throw R}}),b=!0,$||(li=1,Ft=(function(){var O=mr(65548),R=O+12;if((k(),Y)[O>>>2>>>0]=R,(k(),Y)[O+4>>>2>>>0]=R+65536,R=en[0],!Vn.has(R)){var X=V0++;Vn.set(R,X),Fa.set(X,R)}return R=Vn.get(R),(k(),q)[O+8>>>2>>>0]=R,O})(),typeof MainLoop<"u"&&MainLoop.xd&&MainLoop.pause(),$t(()=>eu(Ft)))}else li===2?(li=0,$t(ru),ui(Ft),Ft=null,j0.forEach(z)):Ue(`invalid state: ${li}`);return mi}})(y=>{f().then(y)});function K0(f){return f>>>=0,qa(async()=>{var y=await St(f);return Bt(y)})}var Kn=[],Z0=f=>{var y=Kn.length;return Kn.push(f),y},J0=(f,y)=>{for(var $=Array(f),b=0;b<f;++b){var O=b,R=(k(),Y)[y+4*b>>>2>>>0],X=pr[R];if(X===void 0)throw f=`parameter ${b}`,R=ol(R),y=Nt(R),ui(R),new $i(`${f} has unknown type ${y}`);$[O]=X}return $},Q0=(f,y,$)=>{var b=[];return f=f(b,$),b.length&&((k(),Y)[y>>>2>>>0]=Bt(b)),f},ey={},tn=f=>{var y=ey[f];return y===void 0?Nt(f):y};function ty(f,y,$){var[b,...O]=J0(f,y>>>0);y=b.Yc.bind(b);var R=O.map(he=>he.Xc.bind(he));f--;var X={toValue:St};switch(f=R.map((he,_e)=>{var De=`argFromPtr${_e}`;return X[De]=he,`${De}(args${_e?"+"+8*_e:""})`}),$){case 0:var J="toValue(handle)";break;case 2:J="new (toValue(handle))";break;case 3:J="";break;case 1:X.getStringOrSymbol=tn,J="toValue(handle)[getStringOrSymbol(methodName)]"}return J+=`(${f})`,b.Cd||(X.toReturnWire=y,X.emval_returnValue=Q0,J=`return emval_returnValue(toReturnWire, destructorsRef, ${J})`),J=`return function (handle, methodName, destructorsRef, args) {
  ${J}
  }`,$=new Function(Object.keys(X),J)(...Object.values(X)),J=`methodCaller<(${O.map(he=>he.name)}) => ${b.name}>`,Z0(Object.defineProperty($,"name",{value:J}))}function iy(f,y){return y>>>=0,(f=St(f>>>0))==St(y)}function ry(f){return(f>>>=0)?(f=tn(f),Bt(globalThis[f])):Bt(globalThis)}function ny(f){return f=tn(f>>>0),Bt(t[f])}function sy(f,y){return y>>>=0,f=St(f>>>0),y=St(y),Bt(f[y])}function oy(f){9<(f>>>=0)&&(hi[f+1]+=1)}function Wa(f,y,$,b,O){return Kn[f>>>0](y>>>0,$>>>0,b>>>0,O>>>0)}function ay(f,y,$,b,O){return Wa(f>>>0,y>>>0,$>>>0,b>>>0,O>>>0)}function ly(){return Bt([])}function uy(f){f=St(f>>>0);for(var y=Array(f.length),$=0;$<f.length;$++)y[$]=f[$];return Bt(y)}function dy(f){return Bt(tn(f>>>0))}function py(){return Bt({})}function cy(f){for(var y=St(f>>>=0);y.length;){var $=y.pop();y.pop()($)}cr(f)}function fy(f,y,$){y>>>=0,$>>>=0,f=St(f>>>0),y=St(y),$=St($),f[y]=$}function hy(f,y){f=-9007199254740992>f||9007199254740992<f?NaN:Number(f),y>>>=0,f=new Date(1e3*f),(k(),q)[y>>>2>>>0]=f.getUTCSeconds(),(k(),q)[y+4>>>2>>>0]=f.getUTCMinutes(),(k(),q)[y+8>>>2>>>0]=f.getUTCHours(),(k(),q)[y+12>>>2>>>0]=f.getUTCDate(),(k(),q)[y+16>>>2>>>0]=f.getUTCMonth(),(k(),q)[y+20>>>2>>>0]=f.getUTCFullYear()-1900,(k(),q)[y+24>>>2>>>0]=f.getUTCDay(),f=(f.getTime()-Date.UTC(f.getUTCFullYear(),0,1,0,0,0,0))/864e5|0,(k(),q)[y+28>>>2>>>0]=f}var Xa=f=>f%4==0&&(f%100!=0||f%400==0),Ya=[0,31,60,91,121,152,182,213,244,274,305,335],Ga=[0,31,59,90,120,151,181,212,243,273,304,334];function my(f,y){f=-9007199254740992>f||9007199254740992<f?NaN:Number(f),y>>>=0,f=new Date(1e3*f),(k(),q)[y>>>2>>>0]=f.getSeconds(),(k(),q)[y+4>>>2>>>0]=f.getMinutes(),(k(),q)[y+8>>>2>>>0]=f.getHours(),(k(),q)[y+12>>>2>>>0]=f.getDate(),(k(),q)[y+16>>>2>>>0]=f.getMonth(),(k(),q)[y+20>>>2>>>0]=f.getFullYear()-1900,(k(),q)[y+24>>>2>>>0]=f.getDay();var $=(Xa(f.getFullYear())?Ya:Ga)[f.getMonth()]+f.getDate()-1|0;(k(),q)[y+28>>>2>>>0]=$,(k(),q)[y+36>>>2>>>0]=-60*f.getTimezoneOffset(),$=new Date(f.getFullYear(),6,1).getTimezoneOffset();var b=new Date(f.getFullYear(),0,1).getTimezoneOffset();f=0|($!=b&&f.getTimezoneOffset()==Math.min(b,$)),(k(),q)[y+32>>>2>>>0]=f}function gy(f){f>>>=0;var y=new Date((k(),q)[f+20>>>2>>>0]+1900,(k(),q)[f+16>>>2>>>0],(k(),q)[f+12>>>2>>>0],(k(),q)[f+8>>>2>>>0],(k(),q)[f+4>>>2>>>0],(k(),q)[f>>>2>>>0],0),$=(k(),q)[f+32>>>2>>>0],b=y.getTimezoneOffset(),O=new Date(y.getFullYear(),6,1).getTimezoneOffset(),R=new Date(y.getFullYear(),0,1).getTimezoneOffset(),X=Math.min(R,O);return 0>$?(k(),q)[f+32>>>2>>>0]=+(O!=R&&X==b):0<$!=(X==b)&&(O=Math.max(R,O),y.setTime(y.getTime()+6e4*((0<$?X:O)-b))),(k(),q)[f+24>>>2>>>0]=y.getDay(),$=(Xa(y.getFullYear())?Ya:Ga)[y.getMonth()]+y.getDate()-1|0,(k(),q)[f+28>>>2>>>0]=$,(k(),q)[f>>>2>>>0]=y.getSeconds(),(k(),q)[f+4>>>2>>>0]=y.getMinutes(),(k(),q)[f+8>>>2>>>0]=y.getHours(),(k(),q)[f+12>>>2>>>0]=y.getDate(),(k(),q)[f+16>>>2>>>0]=y.getMonth(),(k(),q)[f+20>>>2>>>0]=y.getYear(),f=y.getTime(),BigInt(isNaN(f)?-1:f/1e3)}function Ha(f,y,$,b,O,R,X){return s?Qe(16,1,f,y,$,b,O,R,X):-52}function Va(f,y,$,b,O,R){if(s)return Qe(17,1,f,y,$,b,O,R)}var hr={},yy=()=>performance.timeOrigin+performance.now();function ja(f,y){if(s)return Qe(18,1,f,y);if(hr[f]&&(clearTimeout(hr[f].id),delete hr[f]),!y)return 0;var $=setTimeout(()=>{delete hr[f],z(()=>pl(f,performance.timeOrigin+performance.now()))},y);return hr[f]={id:$,ce:y},0}function _y(f,y,$,b){f>>>=0,y>>>=0,$>>>=0,b>>>=0;var O=new Date().getFullYear(),R=new Date(O,0,1).getTimezoneOffset();O=new Date(O,6,1).getTimezoneOffset();var X=Math.max(R,O);(k(),Y)[f>>>2>>>0]=60*X,(k(),q)[y>>>2>>>0]=+(R!=O),f=(y=J=>{var he=Math.abs(J);return`UTC${0<=J?"-":"+"}${String(Math.floor(he/60)).padStart(2,"0")}${String(he%60).padStart(2,"0")}`})(R),y=y(O),O<R?(Gt(f,$,17),Gt(y,b,17)):(Gt(f,b,17),Gt(y,$,17))}var vy=()=>Date.now(),wy=1;function by(f,y,$){if($>>>=0,!(0<=f&&3>=f))return 28;if(f===0)f=Date.now();else{if(!wy)return 52;f=performance.timeOrigin+performance.now()}return f=Math.round(1e6*f),(k(),be)[$>>>3>>>0]=BigInt(f),0}var Zn=[],Ka=(f,y)=>{Zn.length=0;for(var $;$=(k(),fe)[f++>>>0];){var b=$!=105;y+=(b&=$!=112)&&y%8?4:0,Zn.push($==112?(k(),Y)[y>>>2>>>0]:$==106?(k(),be)[y>>>3>>>0]:$==105?(k(),q)[y>>>2>>>0]:(k(),Te)[y>>>3>>>0]),y+=b?8:4}return Zn};function xy(f,y,$){return f>>>=0,y=Ka(y>>>0,$>>>0),ss[f](...y)}function $y(f,y,$){return f>>>=0,y=Ka(y>>>0,$>>>0),ss[f](...y)}var Cy=()=>{};function Iy(f,y){return M(pt(f>>>0,y>>>0))}var Ty=()=>{throw vt+=1,"unwind"};function Sy(){return 4294901760}var Py=()=>navigator.hardwareConcurrency,Fi={},rn=f=>{var y;return(y=/\bwasm-function\[\d+\]:(0x[0-9a-f]+)/.exec(f))?+y[1]:(y=/:(\d+):\d+(?:\)|$)/.exec(f))?2147483648|+y[1]:0},Za=f=>{for(var y of f)(f=rn(y))&&(Fi[f]=y)};function Ey(){var f=Error().stack.toString().split(`
`);return f[0]=="Error"&&f.shift(),Za(f),Fi.kd=rn(f[3]),Fi.Md=f,Fi.kd}function nn(f){if(!(f=Fi[f>>>0]))return 0;var y;if(y=/^\s+at .*\.wasm\.(.*) \(.*\)$/.exec(f))f=y[1];else if(y=/^\s+at (.*) \(.*\)$/.exec(f))f=y[1];else{if(!(y=/^(.+?)@/.exec(f)))return 0;f=y[1]}ui(nn.ld??0),y=rr(f)+1;var $=mr(y);return $&&Gt(f,$,y),nn.ld=$,nn.ld}function Ay(f){f>>>=0;var y=(k(),fe).length;if(f<=y||4294901760<f)return!1;for(var $=1;4>=$;$*=2){var b=y*(1+.2/$);b=Math.min(b,f+100663296);e:{b=(Math.min(4294901760,65536*Math.ceil(Math.max(f,b)/65536))-Tt.buffer.byteLength+65535)/65536|0;try{Tt.grow(b),ve();var O=1;break e}catch{}O=void 0}if(O)return!0}return!1}function Oy(f,y,$){if(f>>>=0,y>>>=0,Fi.kd==f)var b=Fi.Md;else(b=Error().stack.toString().split(`
`))[0]=="Error"&&b.shift(),Za(b);for(var O=3;b[O]&&rn(b[O])!=f;)++O;for(f=0;f<$&&b[f+O];++f)(k(),q)[y+4*f>>>2>>>0]=rn(b[f+O]);return f}var Jn,Qn={},Ja=()=>{if(!Jn){var f,y={USER:"web_user",LOGNAME:"web_user",PATH:"/",PWD:"/",HOME:"/home/web_user",LANG:(globalThis.navigator?.language??"C").replace("-","_")+".UTF-8",_:"./this.program"};for(f in Qn)Qn[f]===void 0?delete y[f]:y[f]=Qn[f];var $=[];for(f in y)$.push(`${f}=${y[f]}`);Jn=$}return Jn};function Qa(f,y){if(s)return Qe(19,1,f,y);f>>>=0,y>>>=0;var $,b=0,O=0;for($ of Ja()){var R=y+b;(k(),Y)[f+O>>>2>>>0]=R,b+=Gt($,R,1/0)+1,O+=4}return 0}function el(f,y){if(s)return Qe(20,1,f,y);f>>>=0,y>>>=0;var $=Ja();for(var b of((k(),Y)[f>>>2>>>0]=$.length,f=0,$))f+=rr(b)+1;return(k(),Y)[y>>>2>>>0]=f,0}function tl(f){return s?Qe(21,1,f):52}function il(f,y,$,b,O){return s?Qe(22,1,f,y,$,b,O):52}function rl(f,y,$,b){return s?Qe(23,1,f,y,$,b):52}function nl(f,y,$,b){return s?Qe(24,1,f,y,$,b):70}var ky=[null,[],[]];function sl(f,y,$,b){if(s)return Qe(25,1,f,y,$,b);y>>>=0,$>>>=0,b>>>=0;for(var O=0,R=0;R<$;R++){var X=(k(),Y)[y>>>2>>>0],J=(k(),Y)[y+4>>>2>>>0];y+=8;for(var he=0;he<J;he++){var _e=f,De=(k(),fe)[X+he>>>0],je=ky[_e];De===0||De===10?((_e===1?L:M)(ai(je)),je.length=0):je.push(De)}O+=J}return(k(),Y)[b>>>2>>>0]=O,0}function Ny(f){return f>>>0}s||(function(){for(var f=t.numThreads-1;f--;)si();Be.push(async()=>{var y=(async function(){if(!s)return Promise.all(xt.map(xi))})();Je++,await y,--Je==0&&_t&&(y=_t,_t=null,y())})})(),s||(Tt=new WebAssembly.Memory({initial:256,maximum:65536,shared:!0}),ve()),t.wasmBinary&&(w=t.wasmBinary),t.stackSave=()=>qe(),t.stackRestore=f=>Fe(f),t.stackAlloc=f=>is(f),t.setValue=function(f,y,$="i8"){switch($.endsWith("*")&&($="*"),$){case"i1":case"i8":(k(),ye)[f>>>0]=y;break;case"i16":(k(),ce)[f>>>1>>>0]=y;break;case"i32":(k(),q)[f>>>2>>>0]=y;break;case"i64":(k(),be)[f>>>3>>>0]=BigInt(y);break;case"float":(k(),Ie)[f>>>2>>>0]=y;break;case"double":(k(),Te)[f>>>3>>>0]=y;break;case"*":(k(),Y)[f>>>2>>>0]=y;break;default:Ue(`invalid type for setValue: ${$}`)}},t.getValue=function(f,y="i8"){switch(y.endsWith("*")&&(y="*"),y){case"i1":case"i8":return(k(),ye)[f>>>0];case"i16":return(k(),ce)[f>>>1>>>0];case"i32":return(k(),q)[f>>>2>>>0];case"i64":return(k(),be)[f>>>3>>>0];case"float":return(k(),Ie)[f>>>2>>>0];case"double":return(k(),Te)[f>>>3>>>0];case"*":return(k(),Y)[f>>>2>>>0];default:Ue(`invalid type for getValue: ${y}`)}},t.UTF8ToString=pt,t.stringToUTF8=Gt,t.lengthBytesUTF8=rr;var ol,al,sn,ui,mr,es,ll,ul,dl,ts,pl,cl,Ye,gr,fl,Fe,is,qe,hl,rs,ml,gl,yl,ns,_l,vl,wl,bl,xl,$l,Cl,Il,Tl,Sl,Pl,El,Al,Ol,kl,Nl,Bl,Ll,Ml,Rl,Dl,zl,Fl,Ul,ql,Wl,Xl,Yl,Gl,Hl,Vl,jl,Kl,Zl,Jl,Ql,eu,tu,iu,ru,gi,By=[ri,Et,Ae,zr,Fr,Ur,qr,Wr,Xr,Yr,Gr,Hr,Vr,jr,Kr,Zr,Ha,Va,ja,Qa,el,tl,il,rl,nl,sl],ss={1086876:(f,y,$,b,O)=>{if(t===void 0||!t.ad)return 1;if((f=pt(Number(f>>>0))).startsWith("./")&&(f=f.substring(2)),!(f=t.ad.get(f)))return 2;if(y=Number(y>>>0),$=Number($>>>0),b=Number(b>>>0),y+$>f.byteLength)return 3;try{let R=f.subarray(y,y+$);switch(O){case 0:(k(),fe).set(R,b>>>0);break;case 1:t.Td?t.Td(b,R):t.Ld(b,R);break;default:return 4}return 0}catch{return 4}},1087700:(f,y,$)=>{t.wd(f,(k(),fe).subarray(y>>>0,y+$>>>0))},1087764:()=>t.Vd(),1087806:f=>{t.vd(f)},1087843:()=>{t.Ed()},1087874:()=>{t.Fd()},1087903:()=>{t.Jd()},1087928:f=>t.Dd(f),1087961:f=>t.Hd(f),1087993:(f,y,$)=>{t.jd(Number(f),Number(y),Number($),!0)},1088056:(f,y,$)=>{t.jd(Number(f),Number(y),Number($))},1088113:()=>typeof wasmOffsetConverter<"u",1088170:f=>{t.bc("Abs",f,void 0)},1088221:f=>{t.bc("Neg",f,void 0)},1088272:f=>{t.bc("Floor",f,void 0)},1088325:f=>{t.bc("Ceil",f,void 0)},1088377:f=>{t.bc("Reciprocal",f,void 0)},1088435:f=>{t.bc("Sqrt",f,void 0)},1088487:f=>{t.bc("Exp",f,void 0)},1088538:f=>{t.bc("Erf",f,void 0)},1088589:f=>{t.bc("Sigmoid",f,void 0)},1088644:(f,y,$)=>{t.bc("HardSigmoid",f,{alpha:y,beta:$})},1088723:f=>{t.bc("HardSwish",f,void 0)},1088780:f=>{t.bc("Log",f,void 0)},1088831:f=>{t.bc("Sin",f,void 0)},1088882:f=>{t.bc("Cos",f,void 0)},1088933:f=>{t.bc("Tan",f,void 0)},1088984:f=>{t.bc("Asin",f,void 0)},1089036:f=>{t.bc("Acos",f,void 0)},1089088:f=>{t.bc("Atan",f,void 0)},1089140:f=>{t.bc("Sinh",f,void 0)},1089192:f=>{t.bc("Cosh",f,void 0)},1089244:f=>{t.bc("Asinh",f,void 0)},1089297:f=>{t.bc("Acosh",f,void 0)},1089350:f=>{t.bc("Atanh",f,void 0)},1089403:f=>{t.bc("Tanh",f,void 0)},1089455:f=>{t.bc("Not",f,void 0)},1089506:(f,y,$)=>{t.bc("Clip",f,{min:y,max:$})},1089575:f=>{t.bc("Clip",f,void 0)},1089627:(f,y)=>{t.bc("Elu",f,{alpha:y})},1089685:f=>{t.bc("Gelu",f,void 0)},1089737:f=>{t.bc("Relu",f,void 0)},1089789:(f,y)=>{t.bc("LeakyRelu",f,{alpha:y})},1089853:(f,y)=>{t.bc("ThresholdedRelu",f,{alpha:y})},1089923:(f,y)=>{t.bc("Cast",f,{to:y})},1089981:f=>{t.bc("Add",f,void 0)},1090032:f=>{t.bc("Sub",f,void 0)},1090083:f=>{t.bc("Mul",f,void 0)},1090134:f=>{t.bc("Div",f,void 0)},1090185:f=>{t.bc("Pow",f,void 0)},1090236:f=>{t.bc("Equal",f,void 0)},1090289:f=>{t.bc("Greater",f,void 0)},1090344:f=>{t.bc("GreaterOrEqual",f,void 0)},1090406:f=>{t.bc("Less",f,void 0)},1090458:f=>{t.bc("LessOrEqual",f,void 0)},1090517:(f,y,$,b,O)=>{t.bc("ReduceMean",f,{keepDims:!!y,noopWithEmptyAxes:!!$,axes:b?Array.from((k(),q).subarray(Number(b)>>>0,Number(O)>>>0)):[]})},1090692:(f,y,$,b,O)=>{t.bc("ReduceMax",f,{keepDims:!!y,noopWithEmptyAxes:!!$,axes:b?Array.from((k(),q).subarray(Number(b)>>>0,Number(O)>>>0)):[]})},1090866:(f,y,$,b,O)=>{t.bc("ReduceMin",f,{keepDims:!!y,noopWithEmptyAxes:!!$,axes:b?Array.from((k(),q).subarray(Number(b)>>>0,Number(O)>>>0)):[]})},1091040:(f,y,$,b,O)=>{t.bc("ReduceProd",f,{keepDims:!!y,noopWithEmptyAxes:!!$,axes:b?Array.from((k(),q).subarray(Number(b)>>>0,Number(O)>>>0)):[]})},1091215:(f,y,$,b,O)=>{t.bc("ReduceSum",f,{keepDims:!!y,noopWithEmptyAxes:!!$,axes:b?Array.from((k(),q).subarray(Number(b)>>>0,Number(O)>>>0)):[]})},1091389:(f,y,$,b,O)=>{t.bc("ReduceL1",f,{keepDims:!!y,noopWithEmptyAxes:!!$,axes:b?Array.from((k(),q).subarray(Number(b)>>>0,Number(O)>>>0)):[]})},1091562:(f,y,$,b,O)=>{t.bc("ReduceL2",f,{keepDims:!!y,noopWithEmptyAxes:!!$,axes:b?Array.from((k(),q).subarray(Number(b)>>>0,Number(O)>>>0)):[]})},1091735:(f,y,$,b,O)=>{t.bc("ReduceLogSum",f,{keepDims:!!y,noopWithEmptyAxes:!!$,axes:b?Array.from((k(),q).subarray(Number(b)>>>0,Number(O)>>>0)):[]})},1091912:(f,y,$,b,O)=>{t.bc("ReduceSumSquare",f,{keepDims:!!y,noopWithEmptyAxes:!!$,axes:b?Array.from((k(),q).subarray(Number(b)>>>0,Number(O)>>>0)):[]})},1092092:(f,y,$,b,O)=>{t.bc("ReduceLogSumExp",f,{keepDims:!!y,noopWithEmptyAxes:!!$,axes:b?Array.from((k(),q).subarray(Number(b)>>>0,Number(O)>>>0)):[]})},1092272:f=>{t.bc("Where",f,void 0)},1092325:(f,y,$)=>{t.bc("Transpose",f,{perm:y?Array.from((k(),q).subarray(Number(y)>>>0,Number($)>>>0)):[]})},1092449:(f,y,$,b)=>{t.bc("DepthToSpace",f,{blocksize:y,mode:pt($),format:b?"NHWC":"NCHW"})},1092582:(f,y,$,b)=>{t.bc("DepthToSpace",f,{blocksize:y,mode:pt($),format:b?"NHWC":"NCHW"})},1092715:(f,y,$,b)=>{t.bc("DFT",f,{axis:y,inverse:$,onesided:b})},1092807:(f,y,$,b,O,R,X,J,he,_e,De,je,nt,at,Ii)=>{t.bc("ConvTranspose",f,{format:he?"NHWC":"NCHW",autoPad:y,dilations:[$],group:b,kernelShape:[O],pads:[R,X],strides:[J],wIsConst:()=>!!(k(),ye)[_e>>>0],outputPadding:De?Array.from((k(),q).subarray(Number(De)>>>0,Number(je)>>>0)):[],outputShape:nt?Array.from((k(),q).subarray(Number(nt)>>>0,Number(at)>>>0)):[],activation:pt(Ii)})},1093240:(f,y,$,b,O,R,X,J,he,_e,De,je,nt,at)=>{t.bc("ConvTranspose",f,{format:J?"NHWC":"NCHW",autoPad:y,dilations:Array.from((k(),q).subarray(Number($)>>>0,(Number($)>>>0)+2>>>0)),group:b,kernelShape:Array.from((k(),q).subarray(Number(O)>>>0,(Number(O)>>>0)+2>>>0)),pads:Array.from((k(),q).subarray(Number(R)>>>0,(Number(R)>>>0)+4>>>0)),strides:Array.from((k(),q).subarray(Number(X)>>>0,(Number(X)>>>0)+2>>>0)),wIsConst:()=>!!(k(),ye)[he>>>0],outputPadding:_e?Array.from((k(),q).subarray(Number(_e)>>>0,Number(De)>>>0)):[],outputShape:je?Array.from((k(),q).subarray(Number(je)>>>0,Number(nt)>>>0)):[],activation:pt(at)})},1093901:(f,y,$,b,O,R,X,J,he,_e,De,je,nt,at,Ii)=>{t.bc("ConvTranspose",f,{format:he?"NHWC":"NCHW",autoPad:y,dilations:[$],group:b,kernelShape:[O],pads:[R,X],strides:[J],wIsConst:()=>!!(k(),ye)[_e>>>0],outputPadding:De?Array.from((k(),q).subarray(Number(De)>>>0,Number(je)>>>0)):[],outputShape:nt?Array.from((k(),q).subarray(Number(nt)>>>0,Number(at)>>>0)):[],activation:pt(Ii)})},1094334:(f,y,$,b,O,R,X,J,he,_e,De,je,nt,at)=>{t.bc("ConvTranspose",f,{format:J?"NHWC":"NCHW",autoPad:y,dilations:Array.from((k(),q).subarray(Number($)>>>0,(Number($)>>>0)+2>>>0)),group:b,kernelShape:Array.from((k(),q).subarray(Number(O)>>>0,(Number(O)>>>0)+2>>>0)),pads:Array.from((k(),q).subarray(Number(R)>>>0,(Number(R)>>>0)+4>>>0)),strides:Array.from((k(),q).subarray(Number(X)>>>0,(Number(X)>>>0)+2>>>0)),wIsConst:()=>!!(k(),ye)[he>>>0],outputPadding:_e?Array.from((k(),q).subarray(Number(_e)>>>0,Number(De)>>>0)):[],outputShape:je?Array.from((k(),q).subarray(Number(je)>>>0,Number(nt)>>>0)):[],activation:pt(at)})},1094995:(f,y)=>{t.bc("GlobalAveragePool",f,{format:y?"NHWC":"NCHW"})},1095086:(f,y,$,b,O,R,X,J,he,_e,De,je,nt,at)=>{t.bc("AveragePool",f,{format:at?"NHWC":"NCHW",auto_pad:y,ceil_mode:$,count_include_pad:b,storage_order:O,dilations:R?Array.from((k(),q).subarray(Number(R)>>>0,Number(X)>>>0)):[],kernel_shape:J?Array.from((k(),q).subarray(Number(J)>>>0,Number(he)>>>0)):[],pads:_e?Array.from((k(),q).subarray(Number(_e)>>>0,Number(De)>>>0)):[],strides:je?Array.from((k(),q).subarray(Number(je)>>>0,Number(nt)>>>0)):[]})},1095565:(f,y)=>{t.bc("GlobalAveragePool",f,{format:y?"NHWC":"NCHW"})},1095656:(f,y,$,b,O,R,X,J,he,_e,De,je,nt,at)=>{t.bc("AveragePool",f,{format:at?"NHWC":"NCHW",auto_pad:y,ceil_mode:$,count_include_pad:b,storage_order:O,dilations:R?Array.from((k(),q).subarray(Number(R)>>>0,Number(X)>>>0)):[],kernel_shape:J?Array.from((k(),q).subarray(Number(J)>>>0,Number(he)>>>0)):[],pads:_e?Array.from((k(),q).subarray(Number(_e)>>>0,Number(De)>>>0)):[],strides:je?Array.from((k(),q).subarray(Number(je)>>>0,Number(nt)>>>0)):[]})},1096135:(f,y)=>{t.bc("GlobalMaxPool",f,{format:y?"NHWC":"NCHW"})},1096222:(f,y,$,b,O,R,X,J,he,_e,De,je,nt,at)=>{t.bc("MaxPool",f,{format:at?"NHWC":"NCHW",auto_pad:y,ceil_mode:$,count_include_pad:b,storage_order:O,dilations:R?Array.from((k(),q).subarray(Number(R)>>>0,Number(X)>>>0)):[],kernel_shape:J?Array.from((k(),q).subarray(Number(J)>>>0,Number(he)>>>0)):[],pads:_e?Array.from((k(),q).subarray(Number(_e)>>>0,Number(De)>>>0)):[],strides:je?Array.from((k(),q).subarray(Number(je)>>>0,Number(nt)>>>0)):[]})},1096697:(f,y)=>{t.bc("GlobalMaxPool",f,{format:y?"NHWC":"NCHW"})},1096784:(f,y,$,b,O,R,X,J,he,_e,De,je,nt,at)=>{t.bc("MaxPool",f,{format:at?"NHWC":"NCHW",auto_pad:y,ceil_mode:$,count_include_pad:b,storage_order:O,dilations:R?Array.from((k(),q).subarray(Number(R)>>>0,Number(X)>>>0)):[],kernel_shape:J?Array.from((k(),q).subarray(Number(J)>>>0,Number(he)>>>0)):[],pads:_e?Array.from((k(),q).subarray(Number(_e)>>>0,Number(De)>>>0)):[],strides:je?Array.from((k(),q).subarray(Number(je)>>>0,Number(nt)>>>0)):[]})},1097259:(f,y,$,b,O)=>{t.bc("Gemm",f,{alpha:y,beta:$,transA:b,transB:O})},1097363:f=>{t.bc("MatMul",f,void 0)},1097417:(f,y,$,b)=>{t.bc("ArgMax",f,{keepDims:!!y,selectLastIndex:!!$,axis:b})},1097525:(f,y,$,b)=>{t.bc("ArgMin",f,{keepDims:!!y,selectLastIndex:!!$,axis:b})},1097633:(f,y)=>{t.bc("Softmax",f,{axis:y})},1097696:(f,y)=>{t.bc("Concat",f,{axis:y})},1097756:(f,y,$,b,O)=>{t.bc("Split",f,{axis:y,numOutputs:$,splitSizes:b?Array.from((k(),q).subarray(Number(b)>>>0,Number(O)>>>0)):[]})},1097912:f=>{t.bc("Expand",f,void 0)},1097966:(f,y)=>{t.bc("Gather",f,{axis:Number(y)})},1098037:(f,y)=>{t.bc("GatherElements",f,{axis:Number(y)})},1098116:(f,y)=>{t.bc("GatherND",f,{batch_dims:Number(y)})},1098195:(f,y,$,b,O,R,X,J,he,_e,De)=>{t.bc("Resize",f,{antialias:y,axes:$?Array.from((k(),q).subarray(Number($)>>>0,Number(b)>>>0)):[],coordinateTransformMode:pt(O),cubicCoeffA:R,excludeOutside:X,extrapolationValue:J,keepAspectRatioPolicy:pt(he),mode:pt(_e),nearestMode:pt(De)})},1098557:(f,y,$,b,O,R,X)=>{t.bc("Slice",f,{starts:y?Array.from((k(),q).subarray(Number(y)>>>0,Number($)>>>0)):[],ends:b?Array.from((k(),q).subarray(Number(b)>>>0,Number(O)>>>0)):[],axes:R?Array.from((k(),q).subarray(Number(R)>>>0,Number(X)>>>0)):[]})},1098821:f=>{t.bc("Tile",f,void 0)},1098873:(f,y,$)=>{t.bc("InstanceNormalization",f,{epsilon:y,format:$?"NHWC":"NCHW"})},1098987:(f,y,$)=>{t.bc("InstanceNormalization",f,{epsilon:y,format:$?"NHWC":"NCHW"})},1099101:f=>{t.bc("Range",f,void 0)},1099154:(f,y)=>{t.bc("Einsum",f,{equation:pt(y)})},1099235:(f,y,$,b,O)=>{t.bc("Pad",f,{mode:y,value:$,pads:b?Array.from((k(),q).subarray(Number(b)>>>0,Number(O)>>>0)):[]})},1099378:(f,y,$,b,O,R)=>{t.bc("BatchNormalization",f,{epsilon:y,momentum:$,spatial:!!O,trainingMode:!!b,format:R?"NHWC":"NCHW"})},1099547:(f,y,$,b,O,R)=>{t.bc("BatchNormalization",f,{epsilon:y,momentum:$,spatial:!!O,trainingMode:!!b,format:R?"NHWC":"NCHW"})},1099716:(f,y,$)=>{t.bc("CumSum",f,{exclusive:Number(y),reverse:Number($)})},1099813:(f,y,$)=>{t.bc("DequantizeLinear",f,{axis:y,blockSize:$})},1099903:(f,y,$,b,O)=>{t.bc("GridSample",f,{align_corners:y,mode:pt($),padding_mode:pt(b),format:O?"NHWC":"NCHW"})},1100073:(f,y,$,b,O)=>{t.bc("GridSample",f,{align_corners:y,mode:pt($),padding_mode:pt(b),format:O?"NHWC":"NCHW"})},1100243:(f,y)=>{t.bc("ScatterND",f,{reduction:pt(y)})},1100328:(f,y,$,b,O,R,X,J,he)=>{t.bc("Attention",f,{numHeads:y,isUnidirectional:$,maskFilterValue:b,scale:O,doRotary:R,qkvHiddenSizes:X?Array.from((k(),q).subarray(Number(J)>>>0,Number(J)+X>>>0)):[],pastPresentShareBuffer:!!he})},1100600:f=>{t.bc("BiasAdd",f,void 0)},1100655:f=>{t.bc("BiasSplitGelu",f,void 0)},1100716:f=>{t.bc("FastGelu",f,void 0)},1100772:(f,y,$,b,O,R,X,J,he,_e,De,je,nt,at,Ii,os)=>{t.bc("Conv",f,{format:je?"NHWC":"NCHW",auto_pad:y,dilations:$?Array.from((k(),q).subarray(Number($)>>>0,Number(b)>>>0)):[],group:O,kernel_shape:R?Array.from((k(),q).subarray(Number(R)>>>0,Number(X)>>>0)):[],pads:J?Array.from((k(),q).subarray(Number(J)>>>0,Number(he)>>>0)):[],strides:_e?Array.from((k(),q).subarray(Number(_e)>>>0,Number(De)>>>0)):[],w_is_const:()=>!!(k(),ye)[Number(nt)>>>0],activation:pt(at),activation_params:Ii?Array.from((k(),Ie).subarray(Number(Ii)>>>0,Number(os)>>>0)):[]})},1101356:f=>{t.bc("Gelu",f,void 0)},1101408:(f,y,$,b,O,R,X,J,he)=>{t.bc("GroupQueryAttention",f,{numHeads:y,kvNumHeads:$,scale:b,softcap:O,doRotary:R,rotaryInterleaved:X,smoothSoftmax:J,localWindowSize:he})},1101625:(f,y,$,b)=>{t.bc("LayerNormalization",f,{axis:y,epsilon:$,simplified:!!b})},1101736:(f,y,$,b)=>{t.bc("LayerNormalization",f,{axis:y,epsilon:$,simplified:!!b})},1101847:(f,y,$,b,O,R)=>{t.bc("MatMulNBits",f,{k:y,n:$,accuracyLevel:b,bits:O,blockSize:R})},1101974:(f,y,$,b,O,R)=>{t.bc("MultiHeadAttention",f,{numHeads:y,isUnidirectional:$,maskFilterValue:b,scale:O,doRotary:R})},1102133:(f,y)=>{t.bc("QuickGelu",f,{alpha:y})},1102197:(f,y,$,b,O)=>{t.bc("RotaryEmbedding",f,{interleaved:!!y,numHeads:$,rotaryEmbeddingDim:b,scale:O})},1102336:(f,y,$)=>{t.bc("SkipLayerNormalization",f,{epsilon:y,simplified:!!$})},1102438:(f,y,$)=>{t.bc("SkipLayerNormalization",f,{epsilon:y,simplified:!!$})},1102540:(f,y,$,b)=>{t.bc("GatherBlockQuantized",f,{gatherAxis:y,quantizeAxis:$,blockSize:b})},1102661:f=>{t.Id(f)},1102695:(f,y)=>t.Kd(Number(f),Number(y),t.$c.Nd,t.$c.errors)};function Ly(f,y,$){return qa(async()=>{await t.Gd(Number(f),Number(y),Number($))})}function My(){return typeof wasmOffsetConverter<"u"}function Ry(f,y,$,b){var O=qe();try{return Il(f,y,$,b)}catch(R){if(Fe(O),R!==R+0)throw R;Ye(1,0)}}function Dy(f,y,$){var b=qe();try{return bl(f,y,$)}catch(O){if(Fe(b),O!==O+0)throw O;Ye(1,0)}}function zy(f){var y=qe();try{_l(f)}catch($){if(Fe(y),$!==$+0)throw $;Ye(1,0)}}function Fy(f,y){var $=qe();try{return ns(f,y)}catch(b){if(Fe($),b!==b+0)throw b;Ye(1,0)}}function Uy(f,y,$){var b=qe();try{yl(f,y,$)}catch(O){if(Fe(b),O!==O+0)throw O;Ye(1,0)}}function qy(f,y){var $=qe();try{Tl(f,y)}catch(b){if(Fe($),b!==b+0)throw b;Ye(1,0)}}function Wy(f,y,$,b,O,R,X){var J=qe();try{return $l(f,y,$,b,O,R,X)}catch(he){if(Fe(J),he!==he+0)throw he;Ye(1,0)}}function Xy(f,y,$,b,O,R){var X=qe();try{vl(f,y,$,b,O,R)}catch(J){if(Fe(X),J!==J+0)throw J;Ye(1,0)}}function Yy(f,y,$,b){var O=qe();try{Cl(f,y,$,b)}catch(R){if(Fe(O),R!==R+0)throw R;Ye(1,0)}}function Gy(f,y,$,b,O){var R=qe();try{wl(f,y,$,b,O)}catch(X){if(Fe(R),X!==X+0)throw X;Ye(1,0)}}function Hy(f,y,$,b,O,R,X){var J=qe();try{Pl(f,y,$,b,O,R,X)}catch(he){if(Fe(J),he!==he+0)throw he;Ye(1,0)}}function Vy(f,y,$,b,O,R,X){var J=qe();try{El(f,y,$,b,O,R,X)}catch(he){if(Fe(J),he!==he+0)throw he;Ye(1,0)}}function jy(f,y,$,b,O,R,X,J){var he=qe();try{Nl(f,y,$,b,O,R,X,J)}catch(_e){if(Fe(he),_e!==_e+0)throw _e;Ye(1,0)}}function Ky(f,y,$,b,O){var R=qe();try{return Sl(f,y,$,b,O)}catch(X){if(Fe(R),X!==X+0)throw X;Ye(1,0)}}function Zy(f,y,$){var b=qe();try{return Bl(f,y,$)}catch(O){if(Fe(b),O!==O+0)throw O;Ye(1,0)}}function Jy(f,y,$,b,O,R,X,J){var he=qe();try{Ll(f,y,$,b,O,R,X,J)}catch(_e){if(Fe(he),_e!==_e+0)throw _e;Ye(1,0)}}function Qy(f,y,$,b,O,R,X,J,he,_e,De,je){var nt=qe();try{Al(f,y,$,b,O,R,X,J,he,_e,De,je)}catch(at){if(Fe(nt),at!==at+0)throw at;Ye(1,0)}}function e_(f,y,$){var b=qe();try{return Ml(f,y,$)}catch(O){if(Fe(b),O!==O+0)throw O;return Ye(1,0),0n}}function t_(f,y,$,b,O,R,X,J,he){var _e=qe();try{xl(f,y,$,b,O,R,X,J,he)}catch(De){if(Fe(_e),De!==De+0)throw De;Ye(1,0)}}function i_(f){var y=qe();try{return Rl(f)}catch($){if(Fe(y),$!==$+0)throw $;Ye(1,0)}}function r_(f,y){var $=qe();try{return Ql(f,y)}catch(b){if(Fe($),b!==b+0)throw b;return Ye(1,0),0n}}function n_(f,y,$,b){var O=qe();try{return Dl(f,y,$,b)}catch(R){if(Fe(O),R!==R+0)throw R;Ye(1,0)}}function s_(f){var y=qe();try{return zl(f)}catch($){if(Fe(y),$!==$+0)throw $;return Ye(1,0),0n}}function o_(f,y,$,b){var O=qe();try{return Yl(f,y,$,b)}catch(R){if(Fe(O),R!==R+0)throw R;Ye(1,0)}}function a_(f,y,$,b,O){var R=qe();try{return Gl(f,y,$,b,O)}catch(X){if(Fe(R),X!==X+0)throw X;Ye(1,0)}}function l_(f,y,$,b,O,R){var X=qe();try{return Hl(f,y,$,b,O,R)}catch(J){if(Fe(X),J!==J+0)throw J;Ye(1,0)}}function u_(f,y,$,b,O,R){var X=qe();try{return Ol(f,y,$,b,O,R)}catch(J){if(Fe(X),J!==J+0)throw J;Ye(1,0)}}function d_(f,y,$,b,O,R){var X=qe();try{return Vl(f,y,$,b,O,R)}catch(J){if(Fe(X),J!==J+0)throw J;Ye(1,0)}}function p_(f,y,$,b,O,R,X,J){var he=qe();try{return kl(f,y,$,b,O,R,X,J)}catch(_e){if(Fe(he),_e!==_e+0)throw _e;Ye(1,0)}}function c_(f,y,$,b,O){var R=qe();try{return jl(f,y,$,b,O)}catch(X){if(Fe(R),X!==X+0)throw X;return Ye(1,0),0n}}function f_(f,y,$,b){var O=qe();try{return Kl(f,y,$,b)}catch(R){if(Fe(O),R!==R+0)throw R;Ye(1,0)}}function h_(f,y,$,b){var O=qe();try{return Zl(f,y,$,b)}catch(R){if(Fe(O),R!==R+0)throw R;Ye(1,0)}}function m_(f,y,$,b,O,R,X,J,he,_e,De,je){var nt=qe();try{return Jl(f,y,$,b,O,R,X,J,he,_e,De,je)}catch(at){if(Fe(nt),at!==at+0)throw at;Ye(1,0)}}function g_(f,y,$,b,O,R,X,J,he,_e,De){var je=qe();try{Wl(f,y,$,b,O,R,X,J,he,_e,De)}catch(nt){if(Fe(je),nt!==nt+0)throw nt;Ye(1,0)}}function y_(f,y,$,b,O,R,X,J,he,_e,De,je,nt,at,Ii,os){var b_=qe();try{Xl(f,y,$,b,O,R,X,J,he,_e,De,je,nt,at,Ii,os)}catch(as){if(Fe(b_),as!==as+0)throw as;Ye(1,0)}}function __(f,y,$){var b=qe();try{return Fl(f,y,$)}catch(O){if(Fe(b),O!==O+0)throw O;Ye(1,0)}}function v_(f,y,$){var b=qe();try{return Ul(f,y,$)}catch(O){if(Fe(b),O!==O+0)throw O;Ye(1,0)}}function w_(f,y,$,b){var O=qe();try{ql(f,y,$,b)}catch(R){if(Fe(O),R!==R+0)throw R;Ye(1,0)}}function on(){if(0<Je)_t=on;else if(s)S?.(t),me();else{for(var f=Be;0<f.length;)f.shift()(t);0<Je?_t=on:(t.calledRun=!0,F||(me(),S?.(t)))}}return s||(gi=await et(),on()),t.PTR_SIZE=4,Se?t:new Promise((f,y)=>{S=f,N=y})}var Qt,jo,D_,z_,F_,U_,de,ur,q_,Br,vr,Si,Ki,Hu,Bf,Lf,W_,Mf,X_,ks,mt,Rf,lt,Y_,Df,zf,G_,dn,Ff,Uf,qf,Wf,Xf,H_,Hi,Ar,Ns,Yf,V_,Gf,Hf,j_,Mt,Ko,ei,Vf,Lr,Bs,ti,qt,ki,Ni,jf,Kf,K_,Zo,Z_,J_,Q_,ev,tv,Jf,Wt,Jo,Qf,Ls,Ms,eh,iv,th,ih,ju,rv,Rs,Bo,Ku,Lt,rh,pn,Zu,Ju,Ds,Qu,zs,nh,Fs,sh,Qo,Us,cn,wr,qs,ed,td,id,ea,ot,er,Jt,Tn,tt,ta,oh,nv,rd,nd,sd,qi,od,ah,sv,Vi,vi,ji,Nn,Sn,ia,ra,Lo,Oe,na,lh,ad,ld,ud,dd,sa,pd,Ve,wi,cd,ar,V,Pn,uh,dh,ph,Me,oa,ch,Ws,fd,Xs,hd,Ys,md,Gs,Hs,Vs,gd,fh,ov,br,yd,hh,av,aa,js,fn,hn,_d,vd,Ks,Mo,wd,mh,lv,bd,Ze,dt,lr,mn,ht,ft,Pe,ut,Ro,or,Bi,Ce,xr,Z,we,gh,la,xd,yh,Re,$d,Zs,Cd,Id,Td,Sd,Rt,_h,vh,Li,Pd,Ed,Ad,Od,kd,Nd,Bd,Ld,Md,Rd,Ht,wh,bh,xh,$h,Ch,Ih,Th,Sh,Ph,Eh,uv,Vt,Dd,En,Do,jt,zd,Fd,Ud,qd,Wd,Xd,Yd,Gd,Hd,Vd,Kt,Ah,Oh,kh,Nh,Bh,Lh,Mh,Rh,Dh,zh,ua,Js,Fh,Uh,zo,dv,jd,gn,Kd,Zd,Jd,Mr,Qd,qh,da,ep,tp,ip,Wh,pv,rp,np,Xh,cv,sp,Ke,Yh,Gh,Hh,Vh,jh,Kh,Zh,Jh,Qh,op,em,tm,im,rm,Or,nm,In,sm,om,am,lm,um,dm,pm,cm,fm,hm,mm,gm,ym,_m,vm,wm,bm,Qs,xm,Fo,Uo,$m,Cm,Im,ap,lp,Tm,pa,up,dp,Sm,fv,pp,cp,Zt,Pm,Em,Am,Om,km,Nm,Bm,Lm,Mm,Rm,hv,fp,hp,mp,gp,Dm,zm,mv,Zi,Ji,Qi,ca,tr,gt,Fm,fa,Um,gv,Nr,ha,ma,yp,_p,qo,eo,vp,Wo,wp,An,ga,bp,qm,yv,xp,to,$r,$p,io,Cp,Wm,Xm,_v,Ym,Gm,vv,Ip,yn,Tp,_n,Xo,ro,Sp,Pp,Yo,wv,Hm,bv,Ep,Ap,Op,no,Vm,kp,so,Np,jm,xv,Bp,Km,Zm,$v,Lp,Mp,Rp,Jm,Qm,Cv,yi,Cr,vn,oo,Pi,Dp,zp,Fp,ao,lo,uo,Up,qp,po,Wp,eg,tg,Iv,wn,Ir,co,Xp,Yp,Gp,Hp,fo,Vp,ig,rg,Tv,jp,ho,Kp,Zp,ng,Sv,Jp,sg,Pv,Qp,ec,og,ag,Ev,tc,lg,ug,Av,ic,rc,dg,pg,Ov,nc,sc,cg,fg,kv,oc,ac,hg,mg,Nv,di,_i,Wi,Xi,lc,uc,dc,pc,cc,fc,hc,mc,gg,yg,Bv,It,gc,_g,mo,yc,kr,vg,wg,_c,vc,wc,bc,Go,bg,xg,$g,xc,On,Cg,Ig,$c,Cc,go,Ic,Tg,Lv,yo,Tc,Sc,Sg,Mv,Pc,Ec,Pg,Rv,Ac,Eg,Dv,Oc,kc,Nc,Ag,Og,zv,Bc,Lc,Mc,Rc,Dc,zc,Fc,Uc,kg,Fv,Tr,_o,vo,wo,bo,qc,Wc,xo,$o,Ng,Bg,Co,Lg,Mg,Io,Rg,Dg,zg,Fg,Uv,Xc,Yc,Ug,qg,qv,Gc,Hc,Wg,Wv,Vc,jc,Xg,Yg,Xv,Kc,Zc,Jc,To,Qc,ef,tf,rf,nf,sf,of,af,So,lf,uf,df,pf,cf,Gg,Hg,Yv,ff,hf,Vg,Gv,mf,Sr,gf,Po,yf,_f,jg,Kg,Hv,vf,wf,Zg,Jg,Vv,Eo,bf,xf,$f,Qg,jv,Cf,If,e0,Kv,t0,Zv,i0,Jv,r0,Tf,Sf,Pf,n0,Qv,s0,bn,Ef,o0,ew,Af,ya,_a,Ei,Of,Ao,kn,va,wa,Oo,ba,xa,$a,l0,Ai,Ut,sr,Pr,Er,xn,ko,$n,Yi,Gi,kf,u0,d0,p0,c0,f0,h0,m0,g0,No,Nf,y0,tw,_0,Ho,Vo,v0,iw,rw,nw,b0=S_(()=>{Qt={};jo=Object.defineProperty,D_=Object.getOwnPropertyDescriptor,z_=Object.getOwnPropertyNames,F_=Object.prototype.hasOwnProperty,U_=(e=>typeof Ui<"u"?Ui:typeof Proxy<"u"?new Proxy(e,{get:(t,r)=>(typeof Ui<"u"?Ui:t)[r]}):e)(function(e){if(typeof Ui<"u")return Ui.apply(this,arguments);throw Error('Dynamic require of "'+e+'" is not supported')}),de=(e,t,r)=>()=>{if(r)throw r[0];try{return e&&(t=e(e=0)),t}catch(n){throw r=[n],n}},ur=(e,t)=>{for(var r in t)jo(e,r,{get:t[r],enumerable:!0})},q_=(e,t,r,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let s of z_(t))!F_.call(e,s)&&s!==r&&jo(e,s,{get:()=>t[s],enumerable:!(n=D_(t,s))||n.enumerable});return e},Br=e=>q_(jo({},"__esModule",{value:!0}),e),Lf=de(()=>{"use strict";vr=new Map,Si=[],Ki=(e,t,r)=>{if(t&&typeof t.init=="function"&&typeof t.createInferenceSessionHandler=="function"){let n=vr.get(e);if(n===void 0)vr.set(e,{backend:t,priority:r});else{if(n.priority>r)return;if(n.priority===r&&n.backend!==t)throw new Error(`cannot register backend "${e}" using priority ${r}`)}if(r>=0){let s=Si.indexOf(e);s!==-1&&Si.splice(s,1);for(let l=0;l<Si.length;l++)if(vr.get(Si[l]).priority<=r){Si.splice(l,0,e);return}Si.push(e)}return}throw new TypeError("not a valid backend")},Hu=async e=>{let t=vr.get(e);if(!t)return"backend not found.";if(t.initialized)return t.backend;if(t.aborted)return t.error;{let r=!!t.initPromise;try{return r||(t.initPromise=t.backend.init(e)),await t.initPromise,t.initialized=!0,t.backend}catch(n){return r||(t.error=`${n}`,t.aborted=!0),t.error}finally{delete t.initPromise}}},Bf=async e=>{let t=e.executionProviders||[],r=t.map(p=>typeof p=="string"?p:p.name),n=r.length===0?Si:r,s,l=[],a=new Set;for(let p of n){let c=await Hu(p);typeof c=="string"?l.push({name:p,err:c}):(s||(s=c),s===c&&a.add(p))}if(!s)throw new Error(`no available backend found. ERR: ${l.map(p=>`[${p.name}] ${p.err}`).join(", ")}`);for(let{name:p,err:c}of l)r.includes(p)&&console.warn(`removing requested execution provider "${p}" from session options because it is not available: ${c}`);let d=t.filter(p=>a.has(typeof p=="string"?p:p.name));return[s,new Proxy(e,{get:(p,c)=>c==="executionProviders"?d:Reflect.get(p,c)})]}}),W_=de(()=>{"use strict";Lf()}),X_=de(()=>{"use strict";Mf="1.30.0"}),Rf=de(()=>{"use strict";X_(),ks="warning",mt={wasm:{},webgl:{},webgpu:{},versions:{common:Mf},set logLevel(e){if(e!==void 0){if(typeof e!="string"||["verbose","info","warning","error","fatal"].indexOf(e)===-1)throw new Error(`Unsupported logging level: ${e}`);ks=e}},get logLevel(){return ks}},Object.defineProperty(mt,"logLevel",{enumerable:!0})}),Y_=de(()=>{"use strict";Rf(),lt=mt}),G_=de(()=>{"use strict";Df=(e,t)=>{let r=typeof document<"u"?document.createElement("canvas"):new OffscreenCanvas(1,1);r.width=e.dims[3],r.height=e.dims[2];let n=r.getContext("2d");if(n!=null){let s,l;t?.tensorLayout!==void 0&&t.tensorLayout==="NHWC"?(s=e.dims[2],l=e.dims[3]):(s=e.dims[3],l=e.dims[2]);let a=t?.format!==void 0?t.format:"RGB",d=t?.norm,p,c;d===void 0||d.mean===void 0?p=[255,255,255,255]:typeof d.mean=="number"?p=[d.mean,d.mean,d.mean,d.mean]:(p=[d.mean[0],d.mean[1],d.mean[2],0],d.mean[3]!==void 0&&(p[3]=d.mean[3])),d===void 0||d.bias===void 0?c=[0,0,0,0]:typeof d.bias=="number"?c=[d.bias,d.bias,d.bias,d.bias]:(c=[d.bias[0],d.bias[1],d.bias[2],0],d.bias[3]!==void 0&&(c[3]=d.bias[3]));let g=l*s,_=0,w=g,C=g*2,x=-1;a==="RGBA"?(_=0,w=g,C=g*2,x=g*3):a==="RGB"?(_=0,w=g,C=g*2):a==="RBG"&&(_=0,C=g,w=g*2);for(let S=0;S<l;S++)for(let N=0;N<s;N++){let E=(e.data[_++]-c[0])*p[0],T=(e.data[w++]-c[1])*p[1],B=(e.data[C++]-c[2])*p[2],L=x===-1?255:(e.data[x++]-c[3])*p[3];n.fillStyle="rgba("+E+","+T+","+B+","+L+")",n.fillRect(N,S,1,1)}if("toDataURL"in r)return r.toDataURL();throw new Error("toDataURL is not supported")}else throw new Error("Can not access image data")},zf=(e,t)=>{let r=typeof document<"u"?document.createElement("canvas").getContext("2d"):new OffscreenCanvas(1,1).getContext("2d"),n;if(r!=null){let s,l,a;t?.tensorLayout!==void 0&&t.tensorLayout==="NHWC"?(s=e.dims[2],l=e.dims[1],a=e.dims[3]):(s=e.dims[3],l=e.dims[2],a=e.dims[1]);let d=t!==void 0&&t.format!==void 0?t.format:"RGB",p=t?.norm,c,g;p===void 0||p.mean===void 0?c=[255,255,255,255]:typeof p.mean=="number"?c=[p.mean,p.mean,p.mean,p.mean]:(c=[p.mean[0],p.mean[1],p.mean[2],255],p.mean[3]!==void 0&&(c[3]=p.mean[3])),p===void 0||p.bias===void 0?g=[0,0,0,0]:typeof p.bias=="number"?g=[p.bias,p.bias,p.bias,p.bias]:(g=[p.bias[0],p.bias[1],p.bias[2],0],p.bias[3]!==void 0&&(g[3]=p.bias[3]));let _=l*s;if(t!==void 0&&(t.format!==void 0&&a===4&&t.format!=="RGBA"||a===3&&t.format!=="RGB"&&t.format!=="BGR"))throw new Error("Tensor format doesn't match input tensor dims");let w=4,C=0,x=1,S=2,N=3,E=0,T=_,B=_*2,L=-1;d==="RGBA"?(E=0,T=_,B=_*2,L=_*3):d==="RGB"?(E=0,T=_,B=_*2):d==="RBG"&&(E=0,B=_,T=_*2),n=r.createImageData(s,l);for(let M=0;M<l*s;C+=w,x+=w,S+=w,N+=w,M++)n.data[C]=(e.data[E++]-g[0])*c[0],n.data[x]=(e.data[T++]-g[1])*c[1],n.data[S]=(e.data[B++]-g[2])*c[2],n.data[N]=L===-1?255:(e.data[L++]-g[3])*c[3]}else throw new Error("Can not access image data");return n}}),H_=de(()=>{"use strict";Ko(),dn=(e,t)=>{if(e===void 0)throw new Error("Image buffer must be defined");if(t.height===void 0||t.width===void 0)throw new Error("Image height and width must be defined");if(t.tensorLayout==="NHWC")throw new Error("NHWC Tensor layout is not supported yet");let{height:r,width:n}=t,s=t.norm??{mean:255,bias:0},l,a;typeof s.mean=="number"?l=[s.mean,s.mean,s.mean,s.mean]:l=[s.mean[0],s.mean[1],s.mean[2],s.mean[3]??255],typeof s.bias=="number"?a=[s.bias,s.bias,s.bias,s.bias]:a=[s.bias[0],s.bias[1],s.bias[2],s.bias[3]??0];let d=t.format!==void 0?t.format:"RGBA",p=t.tensorFormat!==void 0&&t.tensorFormat!==void 0?t.tensorFormat:"RGB",c=r*n,g=p==="RGBA"?new Float32Array(c*4):new Float32Array(c*3),_=4,w=0,C=1,x=2,S=3,N=0,E=c,T=c*2,B=-1;d==="RGB"&&(_=3,w=0,C=1,x=2,S=-1),p==="RGBA"?B=c*3:p==="RBG"?(N=0,T=c,E=c*2):p==="BGR"&&(T=0,E=c,N=c*2);for(let L=0;L<c;L++,w+=_,x+=_,C+=_,S+=_)g[N++]=(e[w]+a[0])/l[0],g[E++]=(e[C]+a[1])/l[1],g[T++]=(e[x]+a[2])/l[2],B!==-1&&S!==-1&&(g[B++]=(e[S]+a[3])/l[3]);return p==="RGBA"?new Mt("float32",g,[1,4,r,n]):new Mt("float32",g,[1,3,r,n])},Ff=async(e,t)=>{let r=typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement,n=typeof ImageData<"u"&&e instanceof ImageData,s=typeof ImageBitmap<"u"&&e instanceof ImageBitmap,l=typeof e=="string",a,d=t??{},p=()=>{if(typeof document<"u")return document.createElement("canvas");if(typeof OffscreenCanvas<"u")return new OffscreenCanvas(1,1);throw new Error("Canvas is not supported")},c=g=>typeof HTMLCanvasElement<"u"&&g instanceof HTMLCanvasElement||g instanceof OffscreenCanvas?g.getContext("2d"):null;if(r){let g=p();g.width=e.width,g.height=e.height;let _=c(g);if(_!=null){let w=e.height,C=e.width;if(t!==void 0&&t.resizedHeight!==void 0&&t.resizedWidth!==void 0&&(w=t.resizedHeight,C=t.resizedWidth),t!==void 0){if(d=t,t.tensorFormat!==void 0)throw new Error("Image input config format must be RGBA for HTMLImageElement");d.tensorFormat="RGBA",d.height=w,d.width=C}else d.tensorFormat="RGBA",d.height=w,d.width=C;_.drawImage(e,0,0),a=_.getImageData(0,0,C,w).data}else throw new Error("Can not access image data")}else if(n){let g,_;if(t!==void 0&&t.resizedWidth!==void 0&&t.resizedHeight!==void 0?(g=t.resizedHeight,_=t.resizedWidth):(g=e.height,_=e.width),t!==void 0&&(d=t),d.format="RGBA",d.height=g,d.width=_,t!==void 0){let w=p();w.width=_,w.height=g;let C=c(w);if(C!=null)C.putImageData(e,0,0),a=C.getImageData(0,0,_,g).data;else throw new Error("Can not access image data")}else a=e.data}else if(s){if(t===void 0)throw new Error("Please provide image config with format for Imagebitmap");let g=p();g.width=e.width,g.height=e.height;let _=c(g);if(_!=null){let w=e.height,C=e.width;return _.drawImage(e,0,0,C,w),a=_.getImageData(0,0,C,w).data,d.height=w,d.width=C,dn(a,d)}else throw new Error("Can not access image data")}else{if(l)return new Promise((g,_)=>{let w=p(),C=c(w);if(!e||!C)return _();let x=new Image;x.crossOrigin="Anonymous",x.src=e,x.onload=()=>{w.width=x.width,w.height=x.height,C.drawImage(x,0,0,w.width,w.height);let S=C.getImageData(0,0,w.width,w.height);d.height=w.height,d.width=w.width,g(dn(S.data,d))}});throw new Error("Input data provided is not supported - aborted tensor creation")}if(a!==void 0)return dn(a,d);throw new Error("Input data provided is not supported - aborted tensor creation")},Uf=(e,t)=>{let{width:r,height:n,download:s,dispose:l}=t,a=[1,n,r,4];return new Mt({location:"texture",type:"float32",texture:e,dims:a,download:s,dispose:l})},qf=(e,t)=>{let{dataType:r,dims:n,download:s,dispose:l}=t;return new Mt({location:"gpu-buffer",type:r??"float32",gpuBuffer:e,dims:n,download:s,dispose:l})},Wf=(e,t)=>{let{dataType:r,dims:n,download:s,dispose:l}=t;return new Mt({location:"ml-tensor",type:r??"float32",mlTensor:e,dims:n,download:s,dispose:l})},Xf=(e,t,r)=>new Mt({location:"cpu-pinned",type:e,data:t,dims:r??[t.length]})}),V_=de(()=>{"use strict";Hi=new Map([["float32",Float32Array],["uint8",Uint8Array],["int8",Int8Array],["uint16",Uint16Array],["int16",Int16Array],["int32",Int32Array],["bool",Uint8Array],["float64",Float64Array],["uint32",Uint32Array],["int4",Uint8Array],["uint4",Uint8Array]]),Ar=new Map([[Float32Array,"float32"],[Uint8Array,"uint8"],[Int8Array,"int8"],[Uint16Array,"uint16"],[Int16Array,"int16"],[Int32Array,"int32"],[Float64Array,"float64"],[Uint32Array,"uint32"]]),Ns=!1,Yf=()=>{if(!Ns){Ns=!0;let e=typeof BigInt64Array<"u"&&BigInt64Array.from,t=typeof BigUint64Array<"u"&&BigUint64Array.from,r=globalThis.Float16Array,n=typeof r<"u"&&r.from;e&&(Hi.set("int64",BigInt64Array),Ar.set(BigInt64Array,"int64")),t&&(Hi.set("uint64",BigUint64Array),Ar.set(BigUint64Array,"uint64")),n?(Hi.set("float16",r),Ar.set(r,"float16")):Hi.set("float16",Uint16Array)}}}),j_=de(()=>{"use strict";Ko(),Gf=e=>{let t=1;for(let r=0;r<e.length;r++){let n=e[r];if(typeof n!="number"||!Number.isSafeInteger(n))throw new TypeError(`dims[${r}] must be an integer, got: ${n}`);if(n<0)throw new RangeError(`dims[${r}] must be a non-negative integer, got: ${n}`);t*=n}return t},Hf=(e,t)=>{switch(e.location){case"cpu":return new Mt(e.type,e.data,t);case"cpu-pinned":return new Mt({location:"cpu-pinned",data:e.data,type:e.type,dims:t});case"texture":return new Mt({location:"texture",texture:e.texture,type:e.type,dims:t});case"gpu-buffer":return new Mt({location:"gpu-buffer",gpuBuffer:e.gpuBuffer,type:e.type,dims:t});case"ml-tensor":return new Mt({location:"ml-tensor",mlTensor:e.mlTensor,type:e.type,dims:t});default:throw new Error(`tensorReshape: tensor location ${e.location} is not supported`)}}}),Ko=de(()=>{"use strict";G_(),H_(),V_(),j_(),Mt=class{constructor(e,t,r){Yf();let n,s;if(typeof e=="object"&&"location"in e)switch(this.dataLocation=e.location,n=e.type,s=e.dims,e.location){case"cpu-pinned":{let a=Hi.get(n);if(!a)throw new TypeError(`unsupported type "${n}" to create tensor from pinned buffer`);if(!(e.data instanceof a))throw new TypeError(`buffer should be of type ${a.name}`);this.cpuData=e.data;break}case"texture":{if(n!=="float32")throw new TypeError(`unsupported type "${n}" to create tensor from texture`);this.gpuTextureData=e.texture,this.downloader=e.download,this.disposer=e.dispose;break}case"gpu-buffer":{if(n!=="float32"&&n!=="float16"&&n!=="int32"&&n!=="int64"&&n!=="uint32"&&n!=="uint8"&&n!=="bool"&&n!=="uint4"&&n!=="int4")throw new TypeError(`unsupported type "${n}" to create tensor from gpu buffer`);this.gpuBufferData=e.gpuBuffer,this.downloader=e.download,this.disposer=e.dispose;break}case"ml-tensor":{if(n!=="float32"&&n!=="float16"&&n!=="int32"&&n!=="int64"&&n!=="uint32"&&n!=="uint64"&&n!=="int8"&&n!=="uint8"&&n!=="bool"&&n!=="uint4"&&n!=="int4")throw new TypeError(`unsupported type "${n}" to create tensor from MLTensor`);this.mlTensorData=e.mlTensor,this.downloader=e.download,this.disposer=e.dispose;break}default:throw new Error(`Tensor constructor: unsupported location '${this.dataLocation}'`)}else{let a,d;if(typeof e=="string")if(n=e,d=r,e==="string"){if(!Array.isArray(t))throw new TypeError("A string tensor's data must be a string array.");a=t}else{let p=Hi.get(e);if(p===void 0)throw new TypeError(`Unsupported tensor type: ${e}.`);if(Array.isArray(t)){if(e==="float16"&&p===Uint16Array||e==="uint4"||e==="int4")throw new TypeError(`Creating a ${e} tensor from number array is not supported. Please use ${p.name} as data.`);e==="uint64"||e==="int64"?a=p.from(t,BigInt):a=p.from(t)}else if(t instanceof p)a=t;else if(t instanceof Uint8ClampedArray)if(e==="uint8")a=Uint8Array.from(t);else throw new TypeError("A Uint8ClampedArray tensor's data must be type of uint8");else if(e==="float16"&&t instanceof Uint16Array&&p!==Uint16Array)a=new globalThis.Float16Array(t.buffer,t.byteOffset,t.length);else throw new TypeError(`A ${n} tensor's data must be type of ${p}`)}else if(d=t,Array.isArray(e)){if(e.length===0)throw new TypeError("Tensor type cannot be inferred from an empty array.");let p=typeof e[0];if(p==="string")n="string",a=e;else if(p==="boolean")n="bool",a=Uint8Array.from(e);else throw new TypeError(`Invalid element type of data array: ${p}.`)}else if(e instanceof Uint8ClampedArray)n="uint8",a=Uint8Array.from(e);else{let p=Ar.get(e.constructor);if(p===void 0)throw new TypeError(`Unsupported type for tensor data: ${e.constructor}.`);n=p,a=e}if(d===void 0)d=[a.length];else if(!Array.isArray(d))throw new TypeError("A tensor's dims must be a number array");s=d,this.cpuData=a,this.dataLocation="cpu"}let l=Gf(s);if(this.cpuData&&l!==this.cpuData.length&&!((n==="uint4"||n==="int4")&&Math.ceil(l/2)===this.cpuData.length))throw new Error(`Tensor's size(${l}) does not match data length(${this.cpuData.length}).`);this.type=n,this.dims=s,this.size=l}static async fromImage(e,t){return Ff(e,t)}static fromTexture(e,t){return Uf(e,t)}static fromGpuBuffer(e,t){return qf(e,t)}static fromMLTensor(e,t){return Wf(e,t)}static fromPinnedBuffer(e,t,r){return Xf(e,t,r)}toDataURL(e){return Df(this,e)}toImageData(e){return zf(this,e)}get data(){if(this.ensureValid(),!this.cpuData)throw new Error("The data is not on CPU. Use `getData()` to download GPU data to CPU, or use `texture` or `gpuBuffer` property to access the GPU data directly.");return this.cpuData}get location(){return this.dataLocation}get texture(){if(this.ensureValid(),!this.gpuTextureData)throw new Error("The data is not stored as a WebGL texture.");return this.gpuTextureData}get gpuBuffer(){if(this.ensureValid(),!this.gpuBufferData)throw new Error("The data is not stored as a WebGPU buffer.");return this.gpuBufferData}get mlTensor(){if(this.ensureValid(),!this.mlTensorData)throw new Error("The data is not stored as a WebNN MLTensor.");return this.mlTensorData}async getData(e){switch(this.ensureValid(),this.dataLocation){case"cpu":case"cpu-pinned":return this.data;case"texture":case"gpu-buffer":case"ml-tensor":{if(!this.downloader)throw new Error("The current tensor is not created with a specified data downloader.");if(this.isDownloading)throw new Error("The current tensor is being downloaded.");try{this.isDownloading=!0;let t=await this.downloader();return this.downloader=void 0,this.dataLocation="cpu",this.cpuData=t,e&&this.disposer&&(this.disposer(),this.disposer=void 0),t}finally{this.isDownloading=!1}}default:throw new Error(`cannot get data from location: ${this.dataLocation}`)}}dispose(){if(this.isDownloading)throw new Error("The current tensor is being downloaded.");this.disposer&&(this.disposer(),this.disposer=void 0),this.cpuData=void 0,this.gpuTextureData=void 0,this.gpuBufferData=void 0,this.mlTensorData=void 0,this.downloader=void 0,this.isDownloading=void 0,this.dataLocation="none"}ensureValid(){if(this.dataLocation==="none")throw new Error("The tensor is disposed.")}reshape(e){if(this.ensureValid(),this.downloader||this.disposer)throw new Error("Cannot reshape a tensor that owns GPU resource.");return Hf(this,e)}}}),Vf=de(()=>{"use strict";Ko(),ei=Mt}),jf=de(()=>{"use strict";Rf(),Lr=(e,t)=>{(typeof mt.trace>"u"?!mt.wasm.trace:!mt.trace)||console.timeStamp(`${e}::ORT::${t}`)},Bs=(e,t)=>{let r=new Error().stack?.split(/\r\n|\r|\n/g)||[],n=!1;for(let s=0;s<r.length;s++){if(n&&!r[s].includes("TRACE_FUNC")){let l=`FUNC_${e}::${r[s].trim().split(" ")[1]}`;t&&(l+=`::${t}`),Lr("CPU",l);return}r[s].includes("TRACE_FUNC")&&(n=!0)}},ti=e=>{(typeof mt.trace>"u"?!mt.wasm.trace:!mt.trace)||Bs("BEGIN",e)},qt=e=>{(typeof mt.trace>"u"?!mt.wasm.trace:!mt.trace)||Bs("END",e)},ki=e=>{(typeof mt.trace>"u"?!mt.wasm.trace:!mt.trace)||console.time(`ORT::${e}`)},Ni=e=>{(typeof mt.trace>"u"?!mt.wasm.trace:!mt.trace)||console.timeEnd(`ORT::${e}`)}}),K_=de(()=>{"use strict";Lf(),Vf(),jf(),Kf=class Zf{constructor(t){this.handler=t}async run(t,r,n){ti(),ki("InferenceSession.run");let s={},l={};if(typeof t!="object"||t===null||t instanceof ei||Array.isArray(t))throw new TypeError("'feeds' must be an object that use input names as keys and OnnxValue as corresponding values.");let a=!0;if(typeof r=="object"){if(r===null)throw new TypeError("Unexpected argument[1]: cannot be null.");if(r instanceof ei)throw new TypeError("'fetches' cannot be a Tensor");if(Array.isArray(r)){if(r.length===0)throw new TypeError("'fetches' cannot be an empty array.");a=!1;for(let c of r){if(typeof c!="string")throw new TypeError("'fetches' must be a string array or an object.");if(this.outputNames.indexOf(c)===-1)throw new RangeError(`'fetches' contains invalid output name: ${c}.`);s[c]=null}if(typeof n=="object"&&n!==null)l=n;else if(typeof n<"u")throw new TypeError("'options' must be an object.")}else{let c=!1,g=Object.getOwnPropertyNames(r);for(let _ of this.outputNames)if(g.indexOf(_)!==-1){let w=r[_];(w===null||w instanceof ei)&&(c=!0,a=!1,s[_]=w)}if(c){if(typeof n=="object"&&n!==null)l=n;else if(typeof n<"u")throw new TypeError("'options' must be an object.")}else l=r}}else if(typeof r<"u")throw new TypeError("Unexpected argument[1]: must be 'fetches' or 'options'.");for(let c of this.inputNames)if(typeof t[c]>"u")throw new Error(`input '${c}' is missing in 'feeds'.`);if(a)for(let c of this.outputNames)s[c]=null;let d=await this.handler.run(t,s,l),p={};for(let c in d)if(Object.hasOwnProperty.call(d,c)){let g=d[c];g instanceof ei?p[c]=g:p[c]=new ei(g.type,g.data,g.dims)}return Ni("InferenceSession.run"),qt(),p}async release(){return this.handler.dispose()}static async create(t,r,n,s){ti(),ki("InferenceSession.create");let l,a={};if(typeof t=="string"){if(l=t,typeof r=="object"&&r!==null)a=r;else if(typeof r<"u")throw new TypeError("'options' must be an object.")}else if(t instanceof Uint8Array){if(l=t,typeof r=="object"&&r!==null)a=r;else if(typeof r<"u")throw new TypeError("'options' must be an object.")}else if(t instanceof ArrayBuffer||typeof SharedArrayBuffer<"u"&&t instanceof SharedArrayBuffer){let g=t,_=0,w=t.byteLength;if(typeof r=="object"&&r!==null)a=r;else if(typeof r=="number"){if(_=r,!Number.isSafeInteger(_))throw new RangeError("'byteOffset' must be an integer.");if(_<0||_>=g.byteLength)throw new RangeError(`'byteOffset' is out of range [0, ${g.byteLength}).`);if(w=t.byteLength-_,typeof n=="number"){if(w=n,!Number.isSafeInteger(w))throw new RangeError("'byteLength' must be an integer.");if(w<=0||_+w>g.byteLength)throw new RangeError(`'byteLength' is out of range (0, ${g.byteLength-_}].`);if(typeof s=="object"&&s!==null)a=s;else if(typeof s<"u")throw new TypeError("'options' must be an object.")}else if(typeof n<"u")throw new TypeError("'byteLength' must be a number.")}else if(typeof r<"u")throw new TypeError("'options' must be an object.");l=new Uint8Array(g,_,w)}else throw new TypeError("Unexpected argument[0]: must be 'path' or 'buffer'.");let[d,p]=await Bf(a),c=await d.createInferenceSessionHandler(l,p);return Ni("InferenceSession.create"),qt(),new Zf(c)}startProfiling(){this.handler.startProfiling()}endProfiling(){this.handler.endProfiling()}get inputNames(){return this.handler.inputNames}get outputNames(){return this.handler.outputNames}get inputMetadata(){return this.handler.inputMetadata}get outputMetadata(){return this.handler.outputMetadata}}}),Z_=de(()=>{"use strict";K_(),Zo=Kf}),J_=de(()=>{"use strict"}),Q_=de(()=>{"use strict"}),ev=de(()=>{"use strict"}),tv=de(()=>{"use strict"}),Jf={};ur(Jf,{InferenceSession:()=>Zo,TRACE:()=>Lr,TRACE_EVENT_BEGIN:()=>ki,TRACE_EVENT_END:()=>Ni,TRACE_FUNC_BEGIN:()=>ti,TRACE_FUNC_END:()=>qt,Tensor:()=>ei,env:()=>lt,registerBackend:()=>Ki});Wt=de(()=>{"use strict";W_(),Y_(),Z_(),Vf(),J_(),Q_(),jf(),ev(),tv()}),Jo=de(()=>{"use strict"}),Qf={};ur(Qf,{default:()=>eh});iv=de(()=>{"use strict";l0(),er(),Qo(),Ls="ort-wasm-proxy-worker",Ms=globalThis.self?.name===Ls,Ms&&(self.onmessage=e=>{let{type:t,in:r}=e.data;try{switch(t){case"init-wasm":ea(r.wasm).then(()=>{ya(r).then(()=>{postMessage({type:t})},n=>{postMessage({type:t,err:n})})},n=>{postMessage({type:t,err:n})});break;case"init-ep":{let{epName:n,env:s}=r;_a(s,n).then(()=>{postMessage({type:t})},l=>{postMessage({type:t,err:l})});break}case"copy-from":{let{buffer:n}=r,s=kn(n);postMessage({type:t,out:s});break}case"create":{let{model:n,options:s}=r;va(n,s).then(l=>{postMessage({type:t,out:l})},l=>{postMessage({type:t,err:l})});break}case"release":wa(r),postMessage({type:t});break;case"run":{let{sessionId:n,inputIndices:s,inputs:l,outputIndices:a,options:d}=r;ba(n,s,l,a,new Array(a.length).fill(null),d).then(p=>{p.some(c=>c[3]!=="cpu")?postMessage({type:t,err:"Proxy does not support non-cpu tensor location."}):postMessage({type:t,out:p},$a([...l,...p]))},p=>{postMessage({type:t,err:p})});break}case"end-profiling":xa(r),postMessage({type:t});break;default:}}catch(n){postMessage({type:t,err:n})}}),eh=Ms?null:e=>new Worker(e??Lt,{type:"module",name:Ls})}),th={};ur(th,{default:()=>ih});rv=de(()=>{"use strict";ih=Vu,ju=globalThis.self?.name?.startsWith("em-pthread"),ju&&Vu()}),Qo=de(()=>{"use strict";Jo(),Rs=typeof location>"u"?void 0:location.origin,Bo=Qt.url>"file:"&&Qt.url<"file;",Ku=()=>{if(Bo){let e=URL;return new URL(new e("ort.bundle.min.mjs",Qt.url).href,Rs).href}return Qt.url},Lt=Ku(),rh=()=>{if(Lt&&!Lt.startsWith("blob:"))return Lt.substring(0,Lt.lastIndexOf("/")+1)},pn=(e,t)=>{try{let r=t??Lt;return(r?new URL(e,r):new URL(e)).origin===Rs}catch{return!1}},Zu=(e,t)=>{let r=t??Lt;try{return(r?new URL(e,r):new URL(e)).href}catch{return}},Ju=(e,t)=>`${t??"./"}${e}`,Ds=async e=>{let t=await(await fetch(e,{credentials:"same-origin"})).blob();return URL.createObjectURL(t)},Qu=async e=>(await import(e)).default,zs=(iv(),Br(Qf)).default,nh=async()=>{if(!Lt)throw new Error("Failed to load proxy worker: cannot determine the script source URL.");if(pn(Lt))return[void 0,zs()];let e=await Ds(Lt);return[e,zs(e)]},Fs=(rv(),Br(th)).default,sh=async(e,t,r,n)=>{let s=Fs&&!(e||t);if(s)if(Lt)s=pn(Lt)||n&&!r;else if(n&&!r)s=!0;else throw new Error("cannot determine the script source URL.");if(s)return[void 0,Fs];{let l="ort-wasm-simd-threaded.jsep.mjs",a=e??Zu(l,t),d=r&&a&&!pn(a,t),p=d?await Ds(a):a??Ju(l,t);return[d?p:void 0,await Qu(p)]}}}),er=de(()=>{"use strict";Qo(),cn=!1,wr=!1,qs=!1,ed=()=>{if(typeof SharedArrayBuffer>"u")return!1;try{return typeof MessageChannel<"u"&&new MessageChannel().port1.postMessage(new SharedArrayBuffer(1)),WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,5,4,1,3,1,1,10,11,1,9,0,65,0,254,16,2,0,26,11]))}catch{return!1}},td=()=>{try{return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,30,1,28,0,65,0,253,15,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,253,186,1,26,11]))}catch{return!1}},id=()=>{try{return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,19,1,17,0,65,1,253,15,65,2,253,15,65,3,253,15,253,147,2,11]))}catch{return!1}},ea=async e=>{if(cn)return Promise.resolve();if(wr)throw new Error("multiple calls to 'initializeWebAssembly()' detected.");if(qs)throw new Error("previous call to 'initializeWebAssembly()' failed.");wr=!0;let t=e.initTimeout,r=e.numThreads;if(e.simd!==!1){if(e.simd==="relaxed"){if(!id())throw new Error("Relaxed WebAssembly SIMD is not supported in the current environment.")}else if(!td())throw new Error("WebAssembly SIMD is not supported in the current environment.")}let n=ed();r>1&&!n&&(typeof self<"u"&&!self.crossOriginIsolated&&console.warn("env.wasm.numThreads is set to "+r+", but this will not work unless you enable crossOriginIsolated mode. See https://web.dev/cross-origin-isolation-guide/ for more info."),console.warn("WebAssembly multi-threading is not supported in the current environment. Falling back to single-threading."),e.numThreads=r=1);let s=e.wasmPaths,l=typeof s=="string"?s:void 0,a=s?.mjs,d=a?.href??a,p=s?.wasm,c=p?.href??p,g=e.wasmBinary,[_,w]=await sh(d,l,r>1,!!g||!!c),C=!1,x=[];if(t>0&&x.push(new Promise(S=>{setTimeout(()=>{C=!0,S()},t)})),x.push(new Promise((S,N)=>{let E={numThreads:r};if(g)E.wasmBinary=g,E.locateFile=T=>T;else if(c||l)E.locateFile=T=>c??l+T;else if(d&&d.indexOf("blob:")!==0)E.locateFile=T=>new URL(T,d).href;else if(_){let T=rh();T&&(E.locateFile=B=>T+B)}w(E).then(T=>{wr=!1,cn=!0,Us=T,S(),_&&URL.revokeObjectURL(_)},T=>{wr=!1,qs=!0,N(T)})})),await Promise.race(x),C)throw new Error(`WebAssembly backend initializing failed due to timeout: ${t}ms`)},ot=()=>{if(cn&&Us)return Us;throw new Error("WebAssembly is not initialized yet.")}}),ta=de(()=>{"use strict";er(),Jt=(e,t)=>{let r=ot(),n=r.lengthBytesUTF8(e)+1,s=r._malloc(n);return r.stringToUTF8(e,s,n),t.push(s),s},Tn=(e,t,r,n)=>{if(typeof e=="object"&&e!==null){if(r.has(e))throw new Error("Circular reference in options");r.add(e)}Object.entries(e).forEach(([s,l])=>{let a=t?t+s:s;if(typeof l=="object")Tn(l,a+".",r,n);else if(typeof l=="string"||typeof l=="number")n(a,l.toString());else if(typeof l=="boolean")n(a,l?"1":"0");else throw new Error(`Can't handle extra config type: ${typeof l}`)})},tt=e=>{let t=ot(),r=t.stackSave();try{let n=t.PTR_SIZE,s=t.stackAlloc(2*n);t._OrtGetLastError(s,s+n);let l=Number(t.getValue(s,n===4?"i32":"i64")),a=t.getValue(s+n,"*"),d=a?t.UTF8ToString(a):"";throw new Error(`${e} ERROR_CODE: ${l}, ERROR_MESSAGE: ${d}`)}finally{t.stackRestore(r)}}}),nv=de(()=>{"use strict";er(),ta(),oh=e=>{let t=ot(),r=0,n=[],s=e||{};try{if(e?.logSeverityLevel===void 0)s.logSeverityLevel=2;else if(typeof e.logSeverityLevel!="number"||!Number.isInteger(e.logSeverityLevel)||e.logSeverityLevel<0||e.logSeverityLevel>4)throw new Error(`log severity level is not valid: ${e.logSeverityLevel}`);if(e?.logVerbosityLevel===void 0)s.logVerbosityLevel=0;else if(typeof e.logVerbosityLevel!="number"||!Number.isInteger(e.logVerbosityLevel))throw new Error(`log verbosity level is not valid: ${e.logVerbosityLevel}`);e?.terminate===void 0&&(s.terminate=!1);let l=0;return e?.tag!==void 0&&(l=Jt(e.tag,n)),r=t._OrtCreateRunOptions(s.logSeverityLevel,s.logVerbosityLevel,!!s.terminate,l),r===0&&tt("Can't create run options."),e?.extra!==void 0&&Tn(e.extra,"",new WeakSet,(a,d)=>{let p=Jt(a,n),c=Jt(d,n);t._OrtAddRunConfigEntry(r,p,c)!==0&&tt(`Can't set a run config entry: ${a} - ${d}.`)}),[r,n]}catch(l){throw r!==0&&t._OrtReleaseRunOptions(r),n.forEach(a=>t._free(a)),l}}}),sv=de(()=>{"use strict";er(),ta(),rd=e=>{switch(e){case"disabled":return 0;case"basic":return 1;case"extended":return 2;case"layout":return 3;case"all":return 99;default:throw new Error(`unsupported graph optimization level: ${e}`)}},nd=e=>{switch(e){case"sequential":return 0;case"parallel":return 1;default:throw new Error(`unsupported execution mode: ${e}`)}},sd=e=>{e.extra||(e.extra={}),e.extra.session||(e.extra.session={});let t=e.extra.session;t.use_ort_model_bytes_directly||(t.use_ort_model_bytes_directly="1"),e.executionProviders&&e.executionProviders.some(r=>(typeof r=="string"?r:r.name)==="webgpu")&&(e.enableMemPattern=!1)},qi=(e,t,r,n)=>{let s=Jt(t,n),l=Jt(r,n);ot()._OrtAddSessionConfigEntry(e,s,l)!==0&&tt(`Can't set a session config entry: ${t} - ${r}.`)},od=async(e,t,r)=>{let n=t.executionProviders;for(let s of n){let l=typeof s=="string"?s:s.name,a=[];switch(l){case"webnn":if(l="WEBNN",qi(e,"session.disable_quant_qdq","1",r),qi(e,"session.disable_qdq_constant_folding","1",r),typeof s!="string"){let _=s?.deviceType;_&&qi(e,"deviceType",_,r)}break;case"webgpu":if(l="JS",typeof s!="string"){let _=s;if(_?.preferredLayout){if(_.preferredLayout!=="NCHW"&&_.preferredLayout!=="NHWC")throw new Error(`preferredLayout must be either 'NCHW' or 'NHWC': ${_.preferredLayout}`);qi(e,"preferredLayout",_.preferredLayout,r)}}break;case"wasm":case"cpu":continue;default:throw new Error(`not supported execution provider: ${l}`)}let d=Jt(l,r),p=a.length,c=0,g=0;if(p>0){c=ot()._malloc(p*ot().PTR_SIZE),r.push(c),g=ot()._malloc(p*ot().PTR_SIZE),r.push(g);for(let _=0;_<p;_++)ot().setValue(c+_*ot().PTR_SIZE,a[_][0],"*"),ot().setValue(g+_*ot().PTR_SIZE,a[_][1],"*")}await ot()._OrtAppendExecutionProvider(e,d,c,g,p)!==0&&tt(`Can't append execution provider: ${l}.`)}},ah=async e=>{let t=ot(),r=0,n=[],s=e||{};sd(s);try{let l=rd(s.graphOptimizationLevel??"all"),a=nd(s.executionMode??"sequential"),d=typeof s.logId=="string"?Jt(s.logId,n):0,p=s.logSeverityLevel??2;if(!Number.isInteger(p)||p<0||p>4)throw new Error(`log severity level is not valid: ${p}`);let c=s.logVerbosityLevel??0;if(!Number.isInteger(c)||c<0||c>4)throw new Error(`log verbosity level is not valid: ${c}`);let g=typeof s.optimizedModelFilePath=="string"?Jt(s.optimizedModelFilePath,n):0;if(r=t._OrtCreateSessionOptions(l,!!s.enableCpuMemArena,!!s.enableMemPattern,a,!!s.enableProfiling,0,d,p,c,g),r===0&&tt("Can't create session options."),s.executionProviders&&await od(r,s,n),s.enableGraphCapture!==void 0){if(typeof s.enableGraphCapture!="boolean")throw new Error(`enableGraphCapture must be a boolean value: ${s.enableGraphCapture}`);qi(r,"enableGraphCapture",s.enableGraphCapture.toString(),n)}if(s.freeDimensionOverrides)for(let[_,w]of Object.entries(s.freeDimensionOverrides)){if(typeof _!="string")throw new Error(`free dimension override name must be a string: ${_}`);if(typeof w!="number"||!Number.isInteger(w)||w<0)throw new Error(`free dimension override value must be a non-negative integer: ${w}`);let C=Jt(_,n);t._OrtAddFreeDimensionOverride(r,C,w)!==0&&tt(`Can't set a free dimension override: ${_} - ${w}.`)}return s.extra!==void 0&&Tn(s.extra,"",new WeakSet,(_,w)=>{qi(r,_,w,n)}),[r,n]}catch(l){throw r!==0&&t._OrtReleaseSessionOptions(r)!==0&&tt("Can't release session options."),n.forEach(a=>t._free(a)),l}}}),Oe=de(()=>{"use strict";Vi=e=>{switch(e){case"int8":return 3;case"uint8":return 2;case"bool":return 9;case"int16":return 5;case"uint16":return 4;case"int32":return 6;case"uint32":return 12;case"float16":return 10;case"float32":return 1;case"float64":return 11;case"string":return 8;case"int64":return 7;case"uint64":return 13;case"int4":return 22;case"uint4":return 21;default:throw new Error(`unsupported data type: ${e}`)}},vi=e=>{switch(e){case 3:return"int8";case 2:return"uint8";case 9:return"bool";case 5:return"int16";case 4:return"uint16";case 6:return"int32";case 12:return"uint32";case 10:return"float16";case 1:return"float32";case 11:return"float64";case 8:return"string";case 7:return"int64";case 13:return"uint64";case 22:return"int4";case 21:return"uint4";default:throw new Error(`unsupported data type: ${e}`)}},ji=(e,t)=>{let r=[-1,4,1,1,2,2,4,8,-1,1,2,8,4,8,-1,-1,-1,-1,-1,-1,-1,.5,.5][e],n=typeof t=="number"?t:t.reduce((s,l)=>s*l,1);return r>0?Math.ceil(n*r):void 0},Nn=e=>{switch(e){case"float16":return typeof Float16Array<"u"?Float16Array:Uint16Array;case"float32":return Float32Array;case"uint8":return Uint8Array;case"int8":return Int8Array;case"uint16":return Uint16Array;case"int16":return Int16Array;case"int32":return Int32Array;case"bool":return Uint8Array;case"float64":return Float64Array;case"uint32":return Uint32Array;case"int64":return BigInt64Array;case"uint64":return BigUint64Array;default:throw new Error(`unsupported type: ${e}`)}},Sn=e=>{switch(e){case"verbose":return 0;case"info":return 1;case"warning":return 2;case"error":return 3;case"fatal":return 4;default:throw new Error(`unsupported logging level: ${e}`)}},ia=e=>e==="float32"||e==="float16"||e==="int32"||e==="int64"||e==="uint32"||e==="uint8"||e==="bool"||e==="uint4"||e==="int4",ra=e=>e==="float32"||e==="float16"||e==="int32"||e==="int64"||e==="uint32"||e==="uint64"||e==="int8"||e==="uint8"||e==="bool"||e==="uint4"||e==="int4",Lo=e=>{switch(e){case"none":return 0;case"cpu":return 1;case"cpu-pinned":return 2;case"texture":return 3;case"gpu-buffer":return 4;case"ml-tensor":return 5;default:throw new Error(`unsupported data location: ${e}`)}}}),lh=de(()=>{"use strict";Jo(),na=async e=>{if(typeof e=="string"){let t=await fetch(e);if(!t.ok)throw new Error(`failed to load external data file: ${e}`);let r=t.headers.get("Content-Length"),n=r?parseInt(r,10):0;if(n<1073741824)return new Uint8Array(await t.arrayBuffer());{if(!t.body)throw new Error(`failed to load external data file: ${e}, no response body.`);let s=t.body.getReader(),l;try{l=new ArrayBuffer(n)}catch(d){if(d instanceof RangeError){let p=Math.ceil(n/65536);l=new WebAssembly.Memory({initial:p,maximum:p}).buffer}else throw d}let a=0;for(;;){let{done:d,value:p}=await s.read();if(d)break;let c=p.byteLength;new Uint8Array(l,a,c).set(p),a+=c}return new Uint8Array(l,0,n)}}else return e instanceof Blob?new Uint8Array(await e.arrayBuffer()):e instanceof Uint8Array?e:new Uint8Array(e)}}),wi=de(()=>{"use strict";Oe(),ad=["V","I","W","E","F"],ld=(e,t)=>{console.log(`[${ad[e]},${new Date().toISOString()}]${t}`)},sa=(e,t)=>{ud=e,dd=t},pd=(e,t)=>{let r=Sn(e),n=Sn(ud);r>=n&&ld(r,typeof t=="function"?t():t)},Ve=(...e)=>{dd&&pd(...e)}}),Me=de(()=>{"use strict";cd=class{static calcMatMulShape(e,t){return e[1]!==t[0]?void 0:[e[0],t[1]]}},ar=class{static calcShape(e,t,r=!1){let n=e.length,s=t.length;if(n===0)return t;if(s===0)return e;let l=Math.max(e.length,t.length),a=new Array(l);if(r){if(n<2||s<2)return;let d=cd.calcMatMulShape([e[n-2],e[n-1]],[t[s-2],t[s-1]]);if(d===void 0)return;[a[l-2],a[l-1]]=d}for(let d=r?3:1;d<=l;d++){let p=n-d<0?1:e[n-d],c=s-d<0?1:t[s-d];if(p!==c&&p>1&&c>1)return;let g=Math.max(p,c);if(p&&c)a[l-d]=Math.max(p,c);else{if(g>1)return;a[l-d]=0}}return a}static isValidBroadcast(e,t){let r=e.length,n=t.length;if(r>n)return!1;for(let s=1;s<=r;s++)if(e[r-s]!==1&&e[r-s]!==t[n-s])return!1;return!0}},V=class Cn{static size(t){return Cn.getSizeFromDimensionRange(t,0,t.length)}static convertShape(t,r=4){let n=t.length;if(n===0)return[];let s=new Array(n),l=n-1;for(;l>=0;){if(t[l]%r===0){s[l]=t[l]/r;break}if(r%t[l]!==0)throw new Error("cannot convert shape");s[l]=1,r/=t[l],l--}for(l--;l>=0;l--)s[l]=t[l];return s}static sizeFromDimension(t,r){if(r<0||r>t.length)throw new Error(`invalid dimension of ${r} for sizeFromDimension as Tensor has ${t.length} dimensions.`);return Cn.getSizeFromDimensionRange(t,r,t.length)}static sizeToDimension(t,r){if(r<0||r>t.length)throw new Error(`invalid dimension of ${r} for sizeToDimension as Tensor has ${t.length} dimensions.`);return Cn.getSizeFromDimensionRange(t,0,r)}static getSizeFromDimensionRange(t,r,n){let s=1;for(let l=r;l<n;l++){if(t[l]<0)throw new Error("cannot get valid size from specified dimension range. Most likely the range contains negative values in them.");s*=Number(t[l])}return s}static computeStrides(t){let r=t.length;if(r===0)return[];if(r===1)return[1];let n=new Array(r);n[r-1]=1,n[r-2]=t[r-1];for(let s=r-3;s>=0;--s)n[s]=n[s+1]*t[s+1];return n}static normalizeAxis(t,r){if(t<-r&&t>=r)throw new Error("unsupported axis for this operation.");return t<0?t+r:t}static normalizeAxes(t,r){return t.map(n=>this.normalizeAxis(n,r??t.length))}static sortBasedOnPerm(t,r){return r?r.map(n=>t[n]):t.slice().reverse()}static padShape(t,r){let n=t.length;return t.map((s,l)=>s+r[l]+r[l+n])}static areEqual(t,r){return t.length!==r.length?!1:t.every((n,s)=>n===r[s])}},Pn=class Oi{static adjustPoolAttributes(t,r,n,s,l,a){if(!t&&n.length!==r.length-2)throw new Error("length of specified kernel shapes should be 2 less than length of input dimensions");if(t)for(let d=0;d<r.length-2;d++)d>=n.length?n.push(r[d+2]):n[d]=r[d+2];for(let d=0;d<n.length;d++)if(d<s.length){if(s[d]<0)throw new Error("strides should be greater than or equal to 1")}else s.push(1);for(let d=0;d<n.length;d++)if(d<l.length){if(l[d]<0)throw new Error("dilations should be greater than or equal to 1")}else l.push(1);for(let d=0;d<n.length*2;d++)if(d<a.length){if(a[d]<0)throw new Error("pad should be greater than or equal to 1")}else a.push(0);for(let d=0;d<n.length;d++){if(n[d]<=0)throw new Error("kernel shapes need to be greater than 0");if(a[d]>=n[d]||a[d+n.length]>=n[d])throw new Error("pads should be smaller than kernel")}}static adjustPadsBasedOnAutoPad(t,r,n,s,l,a,d){if(d){if(l.length!==2*(t.length-2))throw new Error("length of pads should be twice the length of data dimensions");if(r.length!==t.length-2)throw new Error("length of strides should be the length of data dimensions");if(s.length!==t.length-2)throw new Error("length of kernel shapes should be the length of data dimensions");for(let p=0;p<t.length-2;p++)Oi.adjustPadAndReturnShape(t[p+(a?1:2)],r[p],n[p],s[p],l,p,p+t.length-2,d)}}static computePoolOutputShape(t,r,n,s,l,a,d,p=0){if(r.length<=0)throw new Error("input shape must be of size greater than 0");let c=[r[0],r[1]];return Oi.computeShapeHelper(t,r,c,n,s,l,a,d,p),c}static computeConvOutputShape(t,r,n,s,l,a,d){if(t.length<=0||r.length<=0)throw new Error("invalid input tensor dims or invalid filter tensor dims");let p=[t[0],r[0]];return Oi.computeShapeHelper(!1,t,p,n,s,l,a,d),p}static computeShapeHelper(t,r,n,s,l,a,d,p,c=0){if(t)for(let g=0;g<r.length-2;g++)n.push(1);else for(let g=0;g<r.length-2;g++)n.push(Oi.adjustPadAndReturnShape(r[g+2],s[g],l[g],a[g],d,g,g+r.length-2,p,c))}static computeOutputSize(t,r,n,s,l){let a=Math.floor(t/r)+1;return l===1&&(a=Math.ceil(t/r)+1,(a-1)*r>=n+s&&(a-=1)),a}static adjustPadAndReturnShape(t,r,n,s,l,a,d,p,c=0){let g=n*(s-1)+1;if(p&&p!=="NOTSET")switch(p){case"VALID":return l[a]=0,l[d]=0,Oi.computeOutputSize(t-g,r,t,0,c);case"SAME_LOWER":case"SAME_UPPER":if(n!==1)throw new Error("Dilation not supported for SAME_UPPER or SAME_LOWER");{let _=(Math.floor((t+r-1)/r)-1)*r+s-t;return l[a]=Math.floor(p==="SAME_LOWER"?(_+1)/2:_/2),l[d]=_-l[a],Oi.computeOutputSize(t+l[a]+l[d]-g,r,t,l[a],c)}default:throw new Error("Unsupported AutoPad type")}else return Oi.computeOutputSize(t+l[a]+l[d]-g,r,t,l[a],c)}},uh=class{static getShapeOfGemmResult(e,t,r,n,s){if(e.length!==2||r.length!==2)throw new Error("shape need to be of size 2");let l,a,d;t?(l=e[1],a=e[0]):(l=e[0],a=e[1]);let p=-1;if(n?(d=r[0],p=1):(d=r[1],p=0),r[p]!==a)throw new Error("dimension mismatch");if(l<=0||d<=0||a<=0)throw new Error("invalid shape specified");if(s&&!ar.isValidBroadcast(s,[l,d]))throw new Error("gemm: invalid bias shape for broadcast");return[l,d,a]}},dh=-34028234663852886e22,ph=34028234663852886e22}),ch=de(()=>{"use strict";Oe(),oa=(e,t)=>new(Nn(t))(e)}),ov=de(()=>{"use strict";Oe(),wi(),Ws=new Map([["float32",32],["float16",16],["int32",32],["uint32",32],["int64",64],["uint64",64],["int8",8],["uint8",8],["int4",4],["uint4",4]]),fd=(e,t)=>{if(t==="int32")return e;let r=Ws.get(t);if(!r)throw new Error(`WebNN backend does not support data type: ${t}`);let n=r/8;if(e.byteLength%n!==0)throw new Error(`Invalid Uint8Array length - must be a multiple of ${n}.`);let s=e.byteLength/n,l=new(Nn(t))(e.buffer,e.byteOffset,s);switch(t){case"int64":case"uint64":{let a=new Int32Array(s);for(let d=0;d<s;d++){let p=l[d];if(p>2147483647n||p<-2147483648n)throw new Error("Can not convert int64 data to int32 - value out of range.");a[d]=Number(p)}return new Uint8Array(a.buffer)}case"int8":case"uint8":case"uint32":{if(t==="uint32"&&l.some(d=>d>2147483647))throw new Error("Can not convert uint32 data to int32 - value out of range.");let a=Int32Array.from(l,Number);return new Uint8Array(a.buffer)}default:throw new Error(`Unsupported data conversion from ${t} to 'int32'`)}},Xs=(e,t)=>{if(t==="int32")return e;if(e.byteLength%4!==0)throw new Error("Invalid Uint8Array length - must be a multiple of 4 (int32).");let r=e.byteLength/4,n=new Int32Array(e.buffer,e.byteOffset,r);switch(t){case"int64":{let s=BigInt64Array.from(n,BigInt);return new Uint8Array(s.buffer)}case"uint64":{if(n.some(l=>l<0))throw new Error("Can not convert int32 data to uin64 - negative value found.");let s=BigUint64Array.from(n,BigInt);return new Uint8Array(s.buffer)}case"int8":{if(n.some(l=>l<-128||l>127))throw new Error("Can not convert int32 data to int8 - value out of range.");let s=Int8Array.from(n,Number);return new Uint8Array(s.buffer)}case"uint8":{if(n.some(s=>s<0||s>255))throw new Error("Can not convert int32 data to uint8 - value out of range.");return Uint8Array.from(n,Number)}case"uint32":{if(n.some(l=>l<0))throw new Error("Can not convert int32 data to uint32 - negative value found.");let s=Uint32Array.from(n,Number);return new Uint8Array(s.buffer)}default:throw new Error(`Unsupported data conversion from 'int32' to ${t}`)}},hd=1,Ys=()=>hd++,md=new Map([["int8","int32"],["uint8","int32"],["uint32","int32"],["int64","int32"]]),Gs=(e,t)=>{let r=Ws.get(e);if(!r)throw new Error(`WebNN backend does not support data type: ${e}`);return t.length>0?Math.ceil(t.reduce((n,s)=>n*s)*r/8):0},Hs=class{constructor(e){this.isDataConverted=!1;let{sessionId:t,context:r,tensor:n,dataType:s,shape:l,fallbackDataType:a}=e;this.sessionId=t,this.mlContext=r,this.mlTensor=n,this.dataType=s,this.tensorShape=l,this.fallbackDataType=a}get tensor(){return this.mlTensor}get type(){return this.dataType}get fallbackType(){return this.fallbackDataType}get shape(){return this.tensorShape}get byteLength(){return Gs(this.dataType,this.tensorShape)}destroy(){Ve("verbose",()=>"[WebNN] TensorWrapper.destroy"),this.mlTensor.destroy()}write(e){this.mlContext.writeTensor(this.mlTensor,e)}async read(e){if(this.fallbackDataType){let t=await this.mlContext.readTensor(this.mlTensor),r=Xs(new Uint8Array(t),this.dataType);if(e){(e instanceof ArrayBuffer?new Uint8Array(e):new Uint8Array(e.buffer,e.byteOffset,e.byteLength)).set(r);return}else return new Uint8Array(r).buffer}else return e?this.mlContext.readTensor(this.mlTensor,e):this.mlContext.readTensor(this.mlTensor)}canReuseTensor(e,t,r){return this.mlContext===e&&this.dataType===t&&this.tensorShape.length===r.length&&this.tensorShape.every((n,s)=>n===r[s])}setIsDataConverted(e){this.isDataConverted=e}},Vs=class{constructor(e,t){this.tensorManager=e,this.wrapper=t}get tensorWrapper(){return this.wrapper}releaseTensor(){this.tensorWrapper&&(this.tensorManager.releaseTensor(this.tensorWrapper),this.wrapper=void 0)}async ensureTensor(e,t,r,n){let s=this.tensorManager.getMLContext(e),l=this.tensorManager.getMLOpSupportLimits(e),a;if(!l?.input.dataTypes.includes(t)){if(a=md.get(t),!a||!l?.input.dataTypes.includes(a))throw new Error(`WebNN backend does not support data type: ${t}`);Ve("verbose",()=>`[WebNN] TensorIdTracker.ensureTensor: fallback dataType from ${t} to ${a}`)}if(this.wrapper){if(this.wrapper.canReuseTensor(s,t,r))return this.wrapper.tensor;if(n){if(this.wrapper.byteLength!==Gs(t,r))throw new Error("Unable to copy data to tensor with different size.");this.activeUpload=new Uint8Array(await this.wrapper.read())}this.tensorManager.releaseTensor(this.wrapper)}let d=typeof MLTensorUsage>"u"?void 0:MLTensorUsage.READ|MLTensorUsage.WRITE;return this.wrapper=await this.tensorManager.getCachedTensor(e,t,r,d,!0,!0,a),n&&this.activeUpload&&(this.wrapper.write(this.activeUpload),this.activeUpload=void 0),this.wrapper.tensor}upload(e){let t=e;if(this.wrapper){if(this.wrapper.fallbackType)if(this.wrapper.fallbackType==="int32")t=fd(e,this.wrapper.type),this.wrapper.setIsDataConverted(!0);else throw new Error(`Unsupported fallback data type: ${this.wrapper.fallbackType}`);if(e.byteLength===this.wrapper.byteLength){this.wrapper.write(t);return}else Ve("verbose",()=>"Data size does not match tensor size. Releasing tensor."),this.releaseTensor()}this.activeUpload?this.activeUpload.set(t):this.activeUpload=new Uint8Array(t)}async download(e){if(this.activeUpload){let t=this.wrapper?.isDataConverted?Xs(this.activeUpload,this.wrapper?.type):this.activeUpload;if(e){e instanceof ArrayBuffer?new Uint8Array(e).set(t):new Uint8Array(e.buffer,e.byteOffset,e.byteLength).set(t);return}else return t.buffer}if(!this.wrapper)throw new Error("Tensor has not been created.");return e?this.wrapper.read(e):this.wrapper.read()}},gd=class{constructor(e){this.backend=e,this.tensorTrackersById=new Map,this.freeTensors=[],this.externalTensors=new Set}getMLContext(e){let t=this.backend.getMLContext(e);if(!t)throw new Error("MLContext not found for session.");return t}getMLOpSupportLimits(e){return this.backend.getMLOpSupportLimits(e)}reserveTensorId(){let e=Ys();return this.tensorTrackersById.set(e,new Vs(this)),e}releaseTensorId(e){let t=this.tensorTrackersById.get(e);t&&(this.tensorTrackersById.delete(e),t.tensorWrapper&&this.releaseTensor(t.tensorWrapper))}async ensureTensor(e,t,r,n,s){Ve("verbose",()=>`[WebNN] TensorManager.ensureTensor {tensorId: ${t}, dataType: ${r}, shape: ${n}, copyOld: ${s}}`);let l=this.tensorTrackersById.get(t);if(!l)throw new Error("Tensor not found.");return l.ensureTensor(e,r,n,s)}upload(e,t){let r=this.tensorTrackersById.get(e);if(!r)throw new Error("Tensor not found.");r.upload(t)}async download(e,t){Ve("verbose",()=>`[WebNN] TensorManager.download {tensorId: ${e}, dstBuffer: ${t?.byteLength}}`);let r=this.tensorTrackersById.get(e);if(!r)throw new Error("Tensor not found.");return r.download(t)}releaseTensorsForSession(e){for(let t of this.freeTensors)t.sessionId===e&&t.destroy();this.freeTensors=this.freeTensors.filter(t=>t.sessionId!==e)}registerTensor(e,t,r,n){let s=this.getMLContext(e),l=Ys(),a=new Hs({sessionId:e,context:s,tensor:t,dataType:r,shape:n});return this.tensorTrackersById.set(l,new Vs(this,a)),this.externalTensors.add(a),l}async getCachedTensor(e,t,r,n,s,l,a){let d=this.getMLContext(e);for(let[c,g]of this.freeTensors.entries())if(g.canReuseTensor(d,t,r)){Ve("verbose",()=>`[WebNN] Reusing tensor {dataType: ${t}, ${a?`fallbackDataType: ${a},`:""} shape: ${r}`);let _=this.freeTensors.splice(c,1)[0];return _.sessionId=e,_}Ve("verbose",()=>`[WebNN] MLContext.createTensor {dataType: ${t}, ${a?`fallbackDataType: ${a},`:""} shape: ${r}}`);let p=await d.createTensor({dataType:a??t,shape:r,dimensions:r,usage:n,writable:s,readable:l});return new Hs({sessionId:e,context:d,tensor:p,dataType:t,shape:r,fallbackDataType:a})}releaseTensor(e){this.externalTensors.has(e)&&this.externalTensors.delete(e),this.freeTensors.push(e)}},fh=(...e)=>new gd(...e)}),av=de(()=>{"use strict";Oe(),er(),ch(),ov(),wi(),br=new Map([[1,"float32"],[10,"float16"],[6,"int32"],[12,"uint32"],[7,"int64"],[13,"uint64"],[22,"int4"],[21,"uint4"],[3,"int8"],[2,"uint8"],[9,"uint8"]]),yd=(e,t)=>{if(e===t)return!0;if(e===void 0||t===void 0)return!1;let r=Object.keys(e).sort(),n=Object.keys(t).sort();return r.length===n.length&&r.every((s,l)=>s===n[l]&&e[s]===t[s])},hh=class{constructor(e){this.tensorManager=fh(this),this.mlContextBySessionId=new Map,this.sessionIdsByMLContext=new Map,this.mlContextCache=[],this.sessionGraphInputs=new Map,this.sessionGraphOutputs=new Map,this.temporaryGraphInputs=[],this.temporaryGraphOutputs=[],this.temporarySessionTensorIds=new Map,this.mlOpSupportLimitsBySessionId=new Map,sa(e.logLevel,!!e.debug)}get currentSessionId(){if(this.activeSessionId===void 0)throw new Error("No active session");return this.activeSessionId}onRunStart(e){Ve("verbose",()=>`[WebNN] onRunStart {sessionId: ${e}}`),this.activeSessionId=e}onRunEnd(e){Ve("verbose",()=>`[WebNN] onRunEnd {sessionId: ${e}}`);let t=this.temporarySessionTensorIds.get(e);if(t){for(let r of t)Ve("verbose",()=>`[WebNN] releasing temporary tensor {tensorId: ${r}}`),this.tensorManager.releaseTensorId(r);this.temporarySessionTensorIds.delete(e),this.activeSessionId=void 0}}async createMLContext(e){if(e instanceof GPUDevice){let r=this.mlContextCache.findIndex(n=>n.gpuDevice===e);if(r!==-1)return this.mlContextCache[r].mlContext;{let n=await navigator.ml.createContext(e);return this.mlContextCache.push({gpuDevice:e,mlContext:n}),n}}else if(e===void 0){let r=this.mlContextCache.findIndex(n=>n.options===void 0&&n.gpuDevice===void 0);if(r!==-1)return this.mlContextCache[r].mlContext;{let n=await navigator.ml.createContext();return this.mlContextCache.push({mlContext:n}),n}}let t=this.mlContextCache.findIndex(r=>yd(r.options,e));if(t!==-1)return this.mlContextCache[t].mlContext;{let r=await navigator.ml.createContext(e);return this.mlContextCache.push({options:e,mlContext:r}),r}}registerMLContext(e,t){this.mlContextBySessionId.set(e,t);let r=this.sessionIdsByMLContext.get(t);r||(r=new Set,this.sessionIdsByMLContext.set(t,r)),r.add(e),this.mlOpSupportLimitsBySessionId.has(e)||this.mlOpSupportLimitsBySessionId.set(e,t.opSupportLimits()),this.temporaryGraphInputs.length>0&&(this.sessionGraphInputs.set(e,this.temporaryGraphInputs),this.temporaryGraphInputs=[]),this.temporaryGraphOutputs.length>0&&(this.sessionGraphOutputs.set(e,this.temporaryGraphOutputs),this.temporaryGraphOutputs=[])}onReleaseSession(e){this.sessionGraphInputs.delete(e),this.sessionGraphOutputs.delete(e);let t=this.mlContextBySessionId.get(e);if(!t)return;this.tensorManager.releaseTensorsForSession(e),this.mlContextBySessionId.delete(e),this.mlOpSupportLimitsBySessionId.delete(e);let r=this.sessionIdsByMLContext.get(t);if(r.delete(e),r.size===0){this.sessionIdsByMLContext.delete(t);let n=this.mlContextCache.findIndex(s=>s.mlContext===t);n!==-1&&this.mlContextCache.splice(n,1)}}getMLContext(e){return this.mlContextBySessionId.get(e)}getMLOpSupportLimits(e){return this.mlOpSupportLimitsBySessionId.get(e)}reserveTensorId(){return this.tensorManager.reserveTensorId()}releaseTensorId(e){Ve("verbose",()=>`[WebNN] releaseTensorId {tensorId: ${e}}`),this.tensorManager.releaseTensorId(e)}async ensureTensor(e,t,r,n,s){let l=br.get(r);if(!l)throw new Error(`Unsupported ONNX data type: ${r}`);return this.tensorManager.ensureTensor(e??this.currentSessionId,t,l,n,s)}async createTemporaryTensor(e,t,r){Ve("verbose",()=>`[WebNN] createTemporaryTensor {onnxDataType: ${t}, shape: ${r}}`);let n=br.get(t);if(!n)throw new Error(`Unsupported ONNX data type: ${t}`);let s=this.tensorManager.reserveTensorId();await this.tensorManager.ensureTensor(e,s,n,r,!1);let l=this.temporarySessionTensorIds.get(e);return l?l.push(s):this.temporarySessionTensorIds.set(e,[s]),s}uploadTensor(e,t){if(!ot().shouldTransferToMLTensor)throw new Error("Trying to upload to a MLTensor while shouldTransferToMLTensor is false");Ve("verbose",()=>`[WebNN] uploadTensor {tensorId: ${e}, data: ${t.byteLength}}`),this.tensorManager.upload(e,t)}async downloadTensor(e,t){return this.tensorManager.download(e,t)}createMLTensorDownloader(e,t){return async()=>{let r=await this.tensorManager.download(e);return oa(r,t)}}registerMLTensor(e,t,r,n){let s=br.get(r);if(!s)throw new Error(`Unsupported ONNX data type: ${r}`);let l=this.tensorManager.registerTensor(e,t,s,n);return Ve("verbose",()=>`[WebNN] registerMLTensor {tensor: ${t}, dataType: ${s}, dimensions: ${n}} -> {tensorId: ${l}}`),l}registerGraphInput(e){this.temporaryGraphInputs.push(e)}registerGraphOutput(e){this.temporaryGraphOutputs.push(e)}isGraphInput(e,t){let r=this.sessionGraphInputs.get(e);return r?r.includes(t):!1}isGraphOutput(e,t){let r=this.sessionGraphOutputs.get(e);return r?r.includes(t):!1}isGraphInputOutputTypeSupported(e,t,r=!0){let n=br.get(Vi(t)),s=this.mlOpSupportLimitsBySessionId.get(e);return typeof n>"u"?!1:r?!!s?.input.dataTypes.includes(n):!!s?.output.dataTypes.includes(n)}flush(){}}}),aa=de(()=>{"use strict"}),lv=de(()=>{"use strict";wi(),aa(),js=new Map([[64,250],[128,200],[256,200],[512,200],[2048,230],[4096,200],[8192,50],[16384,50],[32768,50],[65536,50],[131072,50],[262144,50],[524288,50],[1048576,50],[2097152,30],[4194304,20],[8388608,10],[12582912,10],[16777216,10],[26214400,15],[33554432,22],[44236800,2],[58982400,6],[67108864,6],[134217728,6],[167772160,6]]),fn=[],hn=e=>Math.ceil(Number(e)/16)*16,_d=e=>{for(let t=0;t<fn.length;t++){let r=fn[t];if(e<=r)return r}return Math.ceil(e/16)*16},vd=1,Ks=()=>vd++,Mo=async(e,t,r,n)=>{let s=hn(r),l=e.device.createBuffer({size:s,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{let a=e.getCommandEncoder();e.endComputePass(),a.copyBufferToBuffer(t,0,l,0,s),e.flush(),await l.mapAsync(GPUMapMode.READ);let d=l.getMappedRange();if(n){let p=n();return p.set(new Uint8Array(d,0,r)),p}else return new Uint8Array(d.slice(0,r))}finally{l.destroy()}},wd=class{constructor(e){this.backend=e,this.storageCache=new Map,this.freeBuffers=new Map,this.freeUniformBuffers=new Map,this.buffersPending=[],this.capturedPendingBuffers=new Map;for(let[t]of js)fn.push(t),this.freeBuffers.set(t,[]),this.freeUniformBuffers.set(t,[]);this.sessionCount=0}upload(e,t){let r=t.buffer,n=t.byteOffset,s=t.byteLength,l=hn(s),a=this.storageCache.get(e);if(!a)throw new Error("gpu data for uploading does not exist");if(Number(a.originalSize)!==s)throw new Error(`inconsistent data size. gpu data size=${a.originalSize}, data size=${s}`);if(l===s&&n%4===0)this.backend.device.queue.writeBuffer(a.gpuData.buffer,0,r,n,s);else{let d=new Uint8Array(l);d.set(t),this.backend.device.queue.writeBuffer(a.gpuData.buffer,0,d,0,l)}Ve("verbose",()=>`[WebGPU] GpuDataManager.upload(id=${e})`)}memcpy(e,t){let r=this.storageCache.get(e);if(!r)throw new Error("source gpu data for memcpy does not exist");let n=this.storageCache.get(t);if(!n)throw new Error("destination gpu data for memcpy does not exist");if(r.originalSize!==n.originalSize)throw new Error("inconsistent source and destination gpu data size");let s=hn(r.originalSize),l=this.backend.getCommandEncoder();this.backend.endComputePass(),l.copyBufferToBuffer(r.gpuData.buffer,0,n.gpuData.buffer,0,s)}registerExternalBuffer(e,t,r){let n;if(r){if(n=r[0],e===r[1])return Ve("verbose",()=>`[WebGPU] GpuDataManager.registerExternalBuffer(size=${t}) => id=${n}, buffer is the same, skip.`),n;if(this.backend.capturedCommandList.has(this.backend.currentSessionId))throw new Error(`Registering a different external buffer under graph capture mode is not supported yet.
             Please use the previous external buffer!`)}else n=Ks();return this.storageCache.set(n,{gpuData:{id:n,type:0,buffer:e},originalSize:t}),Ve("verbose",()=>`[WebGPU] GpuDataManager.registerExternalBuffer(size=${t}) => id=${n}, registered.`),n}unregisterExternalBuffer(e){e!==void 0&&(this.storageCache.delete(e),Ve("verbose",()=>`[WebGPU] GpuDataManager.unregisterExternalBuffer() => id=${e}`))}create(e,t=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST){let r=_d(e),n,s=(t&GPUBufferUsage.STORAGE)===GPUBufferUsage.STORAGE,l=(t&GPUBufferUsage.UNIFORM)===GPUBufferUsage.UNIFORM;if(s||l){let d=(s?this.freeBuffers:this.freeUniformBuffers).get(r);d?d.length>0?n=d.pop():n=this.backend.device.createBuffer({size:r,usage:t}):n=this.backend.device.createBuffer({size:r,usage:t})}else n=this.backend.device.createBuffer({size:r,usage:t});let a={id:Ks(),type:0,buffer:n};return this.storageCache.set(a.id,{gpuData:a,originalSize:Number(e)}),Ve("verbose",()=>`[WebGPU] GpuDataManager.create(size=${e}) => id=${a.id}`),a}get(e){return this.storageCache.get(e)?.gpuData}release(e){let t=typeof e=="bigint"?Number(e):e,r=this.storageCache.get(t);if(!r){if(this.storageCache.size===0)return 0;throw new Error("releasing data does not exist")}return Ve("verbose",()=>`[WebGPU] GpuDataManager.release(id=${t}), gpuDataId=${r.gpuData.id}`),this.storageCache.delete(t),this.buffersPending.push(r.gpuData.buffer),r.originalSize}async download(e,t){let r=this.storageCache.get(Number(e));if(!r)throw new Error("data does not exist");await Mo(this.backend,r.gpuData.buffer,r.originalSize,t)}refreshPendingBuffers(){if(this.buffersPending.length!==0)if(this.backend.sessionStatus==="default"){for(let e of this.buffersPending){let t=js.get(e.size);if((e.usage&GPUBufferUsage.STORAGE)===GPUBufferUsage.STORAGE){let r=this.freeBuffers.get(e.size)||[];t===void 0||r.length>=t?e.destroy():r.push(e)}else if((e.usage&GPUBufferUsage.UNIFORM)===GPUBufferUsage.UNIFORM){let r=this.freeUniformBuffers.get(e.size)||[];t===void 0||r.length>=t?e.destroy():r.push(e)}else e.destroy()}this.buffersPending=[]}else{let e=this.capturedPendingBuffers.get(this.backend.currentSessionId);e||(e=[],this.capturedPendingBuffers.set(this.backend.currentSessionId,e));for(let t of this.buffersPending)e.push(t);this.buffersPending=[]}}dispose(){this.freeBuffers.forEach(e=>{e.forEach(t=>{t.destroy()})}),this.freeUniformBuffers.forEach(e=>{e.forEach(t=>{t.destroy()})}),this.storageCache.forEach(e=>{e.gpuData.buffer.destroy()}),this.capturedPendingBuffers.forEach(e=>{e.forEach(t=>{t.destroy()})}),this.storageCache=new Map,this.freeBuffers=new Map,this.freeUniformBuffers=new Map,this.capturedPendingBuffers=new Map}onCreateSession(){this.sessionCount+=1}onReleaseSession(e){let t=this.capturedPendingBuffers.get(e);t&&(t.forEach(r=>{r.destroy()}),this.capturedPendingBuffers.delete(e)),this.sessionCount-=1,this.sessionCount===0&&(Ve("warning",()=>"[WebGPU] Clearing webgpu buffer cache"),this.storageCache.forEach(r=>{r.gpuData.buffer.destroy()}),this.storageCache=new Map)}},mh=(...e)=>new wd(...e)}),dt=de(()=>{"use strict";bd=class{constructor(e){Object.assign(this,e)}get cacheKey(){return this.key||(this.key=Object.getOwnPropertyNames(this).sort().map(e=>`${this[e]}`).join(";")),this.key}},Ze=e=>new bd(e)}),Re=de(()=>{"use strict";Oe(),Me(),lr=64,mn=(e,t)=>{if(t===3)throw new Error("vec3 has same alignment as vec4, use vec4 instead");switch(Number(e)){case 10:return t>1?`vec${t}<f16>`:"f16";case 1:return t>1?`vec${t}<f32>`:"f32";case 6:return t>1?`vec${t}<i32>`:"i32";case 12:return t>1?`vec${t}<u32>`:"u32";case 7:if(t>1)throw new Error("currently not supported vecX of uint64 yet");return["vec2<u32>","i32"];case 13:if(t>1)throw new Error("currently not supported vecX of uint64 yet");return["vec2<u32>","u32"];case 9:if(t!==4)throw new Error("bool must be vec4");return["u32","vec4<bool>"];case 22:return"i32";case 21:return"u32";default:throw new Error(`Unknown data type: ${e}`)}},ht=(e,t=1)=>{let r=mn(e,t);return typeof r=="string"?r:r[0]},ft=(e,t=1)=>{let r=mn(e,t);return typeof r=="string"?r:r[1]},Pe=(...e)=>{let t=[];return e.forEach(r=>{r.length!==0&&t.push({type:12,data:r},{type:12,data:V.computeStrides(r)})}),t},ut=e=>e%4===0?4:e%2===0?2:1,Ro=(e="f32",t,r="0")=>!t||t===1?`${e}(${r})`:`vec${t}<${e}>(${r})`,or=(e,t,r)=>e==="f32"?r:t===1?`f32(${r})`:`vec${t}<f32>(${r})`,Bi=(e,t)=>t===4?`(${e}.x + ${e}.y + ${e}.z + ${e}.w)`:t===2?`(${e}.x + ${e}.y)`:t===3?`(${e}.x + ${e}.y + ${e}.z)`:e,Ce=(e,t,r,n)=>e.startsWith("uniforms.")&&r>4?typeof t=="string"?n==="f16"?`${e}[(${t}) / 8][(${t}) % 8 / 4][(${t}) % 8 % 4]`:`${e}[(${t}) / 4][(${t}) % 4]`:n==="f16"?`${e}[${Math.floor(t/8)}][${Math.floor(t%8/4)}][${t%8%4}]`:`${e}[${Math.floor(t/4)}][${t%4}]`:r>1?`${e}[${t}]`:e,xr=(e,t,r,n,s)=>{let l=typeof r=="number",a=l?r:r.length,d=[...new Array(a).keys()],p=a<2?"u32":a<=4?`vec${a}<u32>`:`array<u32, ${a}>`,c=mn(t,s),g=typeof c=="string"?c:c[1],_=typeof c=="string"?c:c[0],w={indices:p,value:g,storage:_,tensor:t},C=ne=>typeof ne=="string"?ne:`${ne}u`,x={offsetToIndices:!1,indicesToOffset:!1,broadcastedIndicesToOffset:!1,set:!1,setByIndices:!1,get:!1,getByIndices:!1},S=l?"uniforms.":"",N=`${S}${e}_shape`,E=`${S}${e}_strides`,T="";for(let ne=0;ne<a-1;ne++)T+=`
    let dim${ne} = current / ${Ce(E,ne,a)};
    let rest${ne} = current % ${Ce(E,ne,a)};
    indices[${ne}] = dim${ne};
    current = rest${ne};
    `;T+=`indices[${a-1}] = current;`;let B=a<2?"":`
  fn o2i_${e}(offset: u32) -> ${w.indices} {
    var indices: ${w.indices};
    var current = offset;
    ${T}
    return indices;
  }`,L=ne=>(x.offsetToIndices=!0,a<2?ne:`o2i_${e}(${ne})`),M=[];if(a>=2)for(let ne=a-1;ne>=0;ne--)M.push(`${Ce(E,ne,a)} * (indices[${ne}])`);let F=a<2?"":`
  fn i2o_${e}(indices: ${w.indices}) -> u32 {
    return ${M.join("+")};
  }`,U=ne=>(x.indicesToOffset=!0,a<2?ne:`i2o_${e}(${ne})`),k=(...ne)=>a===0?"0u":`${w.indices}(${ne.map(C).join(",")})`,re=(ne,Se)=>a<2?`${ne}`:`${Ce(ne,Se,a)}`,oe=(ne,Se,ve)=>a<2?`${ne}=${ve};`:`${Ce(ne,Se,a)}=${ve};`,ye={},fe=(ne,Se)=>{x.broadcastedIndicesToOffset=!0;let ve=`${Se.name}broadcastedIndicesTo${e}Offset`;if(ve in ye)return`${ve}(${ne})`;let me=[];for(let Ue=a-1;Ue>=0;Ue--){let st=Se.indicesGet("outputIndices",Ue+Se.rank-a);me.push(`${re(E,Ue)} * (${st} % ${re(N,Ue)})`)}return ye[ve]=`fn ${ve}(outputIndices: ${Se.type.indices}) -> u32 {
             return ${me.length>0?me.join("+"):"0u"};
           }`,`${ve}(${ne})`},ce=(ne,Se)=>(()=>{if(w.storage===w.value)return`${e}[${ne}]=${Se};`;if(w.storage==="vec2<u32>"&&w.value==="i32")return`${e}[${ne}]=vec2<u32>(u32(${Se}), select(0u, 0xFFFFFFFFu, ${Se} < 0));`;if(w.storage==="vec2<u32>"&&w.value==="u32")return`${e}[${ne}]=vec2<u32>(u32(${Se}), 0u);`;if(w.storage==="u32"&&w.value==="vec4<bool>")return`${e}[${ne}]=dot(vec4<u32>(0x1, 0x100, 0x10000, 0x1000000), vec4<u32>(${Se}));`;throw new Error(`not supported combination of storage type ${w.storage} and value type ${w.value} yet`)})(),$e=ne=>(()=>{if(w.storage===w.value)return`${e}[${ne}]`;if(w.storage==="vec2<u32>"&&w.value==="i32")return`i32(${e}[${ne}].x)`;if(w.storage==="vec2<u32>"&&w.value==="u32")return`u32(${e}[${ne}].x)`;if(w.storage==="u32"&&w.value==="vec4<bool>")return`vec4<bool>(bool(${e}[${ne}] & 0xFFu), bool(${e}[${ne}] & 0xFF00u), bool(${e}[${ne}] & 0xFF0000u), bool(${e}[${ne}] & 0xFF000000u))`;throw new Error(`not supported combination of storage type ${w.storage} and value type ${w.value} yet`)})(),q=a<2?"":`
  fn get_${e}ByIndices(indices: ${w.indices}) -> ${g} {
    return ${$e(`i2o_${e}(indices)`)};
  }`,Y=a<2?"":(()=>{let ne=d.map(ve=>`d${ve}: u32`).join(", "),Se=d.map(ve=>`d${ve}`).join(", ");return`
  fn get_${e}(${ne}) -> ${g} {
    return get_${e}ByIndices(${k(Se)});
  }`})(),Ie=(...ne)=>{if(ne.length!==a)throw new Error(`indices length must be ${a}`);let Se=ne.map(C).join(",");return a===0?$e("0u"):a===1?$e(Se[0]):(x.get=!0,x.getByIndices=!0,x.indicesToOffset=!0,`get_${e}(${Se})`)},Te=ne=>a<2?$e(ne):(x.getByIndices=!0,x.indicesToOffset=!0,`get_${e}ByIndices(${ne})`),be=a<2?"":`
  fn set_${e}ByIndices(indices: ${w.indices}, value: ${g}) {
    ${ce(`i2o_${e}(indices)`,"value")}
  }`,ke=a<2?"":(()=>{let ne=d.map(ve=>`d${ve}: u32`).join(", "),Se=d.map(ve=>`d${ve}`).join(", ");return`
  fn set_${e}(${ne}, value: ${g}) {
    set_${e}ByIndices(${k(Se)}, value);
  }`})();return{impl:()=>{let ne=[],Se=!1;return x.offsetToIndices&&(ne.push(B),Se=!0),x.indicesToOffset&&(ne.push(F),Se=!0),x.broadcastedIndicesToOffset&&(Object.values(ye).forEach(ve=>ne.push(ve)),Se=!0),x.set&&(ne.push(ke),Se=!0),x.setByIndices&&(ne.push(be),Se=!0),x.get&&(ne.push(Y),Se=!0),x.getByIndices&&(ne.push(q),Se=!0),!l&&Se&&ne.unshift(`const ${N} = ${w.indices}(${r.join(",")});`,`const ${E} = ${w.indices}(${V.computeStrides(r).join(",")});`),ne.join(`
`)},type:w,offsetToIndices:L,indicesToOffset:U,broadcastedIndicesToOffset:fe,indices:k,indicesGet:re,indicesSet:oe,set:(...ne)=>{if(ne.length!==a+1)throw new Error(`indices length must be ${a}`);let Se=ne[a];if(typeof Se!="string")throw new Error("value must be string");let ve=ne.slice(0,a).map(C).join(",");return a===0?ce("0u",Se):a===1?ce(ve[0],Se):(x.set=!0,x.setByIndices=!0,x.indicesToOffset=!0,`set_${e}(${ve}, ${Se})`)},setByOffset:ce,setByIndices:(ne,Se)=>a<2?ce(ne,Se):(x.setByIndices=!0,x.indicesToOffset=!0,`set_${e}ByIndices(${ne}, ${Se});`),get:Ie,getByOffset:$e,getByIndices:Te,usage:n,name:e,strides:E,shape:N,rank:a}},Z=(e,t,r,n=1)=>xr(e,t,r,"input",n),we=(e,t,r,n=1)=>xr(e,t,r,"output",n),gh=(e,t,r)=>xr(e,t,r,"atomicOutput",1),la=(e,t,r,n=1)=>xr(e,t,r,"internal",n),xd=class{constructor(e,t){this.normalizedDispatchGroup=e,this.limits=t,this.internalVariables=[],this.variables=[],this.uniforms=[],this.variableIndex=0}guardAgainstOutOfBoundsWorkgroupSizes(e){return`if (global_idx >= ${typeof e=="number"?`${e}u`:e}) { return; }`}mainStart(e=lr){let t=typeof e=="number"?e:e[0],r=typeof e=="number"?1:e[1],n=typeof e=="number"?1:e[2];if(t>this.limits.maxComputeWorkgroupSizeX||r>this.limits.maxComputeWorkgroupSizeY||n>this.limits.maxComputeWorkgroupSizeZ)throw new Error(`workgroup size [${t}, ${r}, ${n}] exceeds the maximum workgroup size [${this.limits.maxComputeWorkgroupSizeX}, ${this.limits.maxComputeWorkgroupSizeY}, ${this.limits.maxComputeWorkgroupSizeZ}].`);if(t*r*n>this.limits.maxComputeInvocationsPerWorkgroup)throw new Error(`workgroup size [${t}, ${r}, ${n}] exceeds the maximum workgroup invocations ${this.limits.maxComputeInvocationsPerWorkgroup}.`);let s=this.normalizedDispatchGroup[1]===1&&this.normalizedDispatchGroup[2]===1,l=s?`@builtin(global_invocation_id) global_id : vec3<u32>,
    @builtin(workgroup_id) workgroup_id : vec3<u32>,
    @builtin(local_invocation_index) local_idx : u32,
    @builtin(local_invocation_id) local_id : vec3<u32>`:`@builtin(global_invocation_id) global_id : vec3<u32>,
                                             @builtin(local_invocation_id) local_id : vec3<u32>,
    @builtin(local_invocation_index) local_idx : u32,
    @builtin(workgroup_id) workgroup_id : vec3<u32>,
    @builtin(num_workgroups) num_workgroups : vec3<u32>`,a=s?`let global_idx = global_id.x;
         let workgroup_index = workgroup_id.x;`:`let workgroup_index = workgroup_id.z * num_workgroups[0] * num_workgroups[1] +
             workgroup_id.y * num_workgroups[0] + workgroup_id.x;
         let global_idx = workgroup_index * ${t*r*n}u + local_idx;`;return`@compute @workgroup_size(${t}, ${r}, ${n})
  fn main(${l}) {
    ${a}
  `}appendVariableUniforms(e){e.rank!==0&&(e.shape.startsWith("uniforms.")&&this.uniforms.push({name:e.shape.replace("uniforms.",""),type:"u32",length:e.rank}),e.strides.startsWith("uniforms.")&&this.uniforms.push({name:e.strides.replace("uniforms.",""),type:"u32",length:e.rank}))}declareVariable(e,t){if(e.usage==="internal")throw new Error("cannot use internal variable with declareVariable(). use registerInternalVariables() instead.");this.variables.push(e),this.appendVariableUniforms(e);let r=e.usage==="input"?"read":"read_write",n=e.usage==="atomicOutput"?"atomic<i32>":e.type.storage;return`@group(0) @binding(${t}) var<storage, ${r}> ${e.name}: array<${n}>;`}declareVariables(...e){return e.map(t=>this.declareVariable(t,this.variableIndex++)).join(`
`)}registerInternalVariable(e){if(e.usage!=="internal")throw new Error("cannot use input or output variable with registerInternalVariable(). use declareVariables() instead.");this.internalVariables.push(e),this.appendVariableUniforms(e)}registerInternalVariables(...e){return e.forEach(t=>this.registerInternalVariable(t)),this}registerUniform(e,t,r=1){return this.uniforms.push({name:e,type:t,length:r}),this}registerUniforms(e){return this.uniforms=this.uniforms.concat(e),this}uniformDeclaration(){if(this.uniforms.length===0)return"";let e=[];for(let{name:t,type:r,length:n}of this.uniforms)if(n&&n>4)r==="f16"?e.push(`@align(16) ${t}:array<mat2x4<${r}>, ${Math.ceil(n/8)}>`):e.push(`${t}:array<vec4<${r}>, ${Math.ceil(n/4)}>`);else{let s=n==null||n===1?r:`vec${n}<${r}>`;e.push(`${t}:${s}`)}return`
      struct Uniforms { ${e.join(", ")} };
      @group(0) @binding(${this.variableIndex}) var<uniform> uniforms: Uniforms;`}get additionalImplementations(){return this.uniformDeclaration()+this.variables.map(e=>e.impl()).join(`
`)+this.internalVariables.map(e=>e.impl()).join(`
`)}get variablesInfo(){if(this.uniforms.length===0)return;let e=t=>[12,10,1,6][["u32","f16","f32","i32"].indexOf(t)];return this.uniforms.map(t=>[e(t.type),t.length??1])}},yh=(e,t)=>new xd(e,t)}),Li=de(()=>{"use strict";Oe(),Me(),dt(),Re(),$d=(e,t)=>{if(!e||e.length!==1)throw new Error("Transpose requires 1 input.");if(t.length!==0&&t.length!==e[0].dims.length)throw new Error(`perm size ${t.length} does not match input rank ${e[0].dims.length}`)},Zs=(e,t)=>t.length!==0?t:[...new Array(e).keys()].reverse(),Cd=(e,t)=>V.sortBasedOnPerm(e,Zs(e.length,t)),Id=(e,t,r,n)=>{let s=`fn perm(i: ${n.type.indices}) -> ${r.type.indices} {
    var a: ${r.type.indices};`;for(let l=0;l<t;++l)s+=`a[${e[l]}]=i[${l}];`;return s+="return a;}"},Td=(e,t)=>{let r=[],n=[];for(let s=0;s<e.length;++s)e[s]!==1&&r.push(e[s]),e[t[s]]!==1&&n.push(t[s]);return{newShape:r,newPerm:n}},Sd=(e,t)=>{let r=0;for(let n=0;n<e.length;++n)if(t[e[n]]!==1){if(e[n]<r)return!1;r=e[n]}return!0},Rt=(e,t)=>{let r=e.dataType,n=e.dims.length,s=Zs(n,t),l=Cd(e.dims,s),a=e.dims,d=l,p=n<2||Sd(s,e.dims),c;if(p)return c=x=>{let S=Z("input",r,a,4),N=we("output",r,d,4);return`
  ${x.registerUniform("output_size","u32").declareVariables(S,N)}
  ${x.mainStart()}
    ${x.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    output[global_idx] = input[global_idx];
  }`},{name:"TransposeCopy",shaderCache:{inputDependencies:["type"]},getRunData:()=>{let x=V.size(l);return{outputs:[{dims:l,dataType:e.dataType}],dispatchGroup:{x:Math.ceil(x/64/4)},programUniforms:[{type:12,data:Math.ceil(x/4)}]}},getShaderSource:c};let{newShape:g,newPerm:_}=Td(e.dims,s),w=V.areEqual(_,[2,3,1]),C=V.areEqual(_,[3,1,2]);if(g.length===2||w||C){a=w?[g[0],g[1]*g[2]]:C?[g[0]*g[1],g[2]]:g,d=[a[1],a[0]];let x=16;return c=S=>{let N=Z("a",r,a.length),E=we("output",r,d.length);return`
  ${S.registerUniform("output_size","u32").declareVariables(N,E)}
  var<workgroup> tile : array<array<${E.type.value}, ${x+1}>, ${x}>;
  ${S.mainStart([x,x,1])}
    let stride = (uniforms.output_shape[1] - 1) / ${x} + 1;
    let workgroup_id_x = workgroup_index % stride;
    let workgroup_id_y = workgroup_index / stride;
    let input_col = workgroup_id_y * ${x}u + local_id.x;
    let input_row = workgroup_id_x * ${x}u + local_id.y;
    if (input_row < uniforms.a_shape[0] && input_col < uniforms.a_shape[1]) {
      tile[local_id.y][local_id.x] = ${N.getByIndices(`${N.type.indices}(input_row, input_col)`)};
    }
    workgroupBarrier();

    let output_col = workgroup_id_x * ${x}u + local_id.x;
    let output_row = workgroup_id_y * ${x}u + local_id.y;
    if (output_row < uniforms.output_shape[0] && output_col < uniforms.output_shape[1]) {
      ${E.setByIndices(`${E.type.indices}(output_row, output_col)`,"tile[local_id.x][local_id.y]")}
    }
  }`},{name:"TransposeShared",shaderCache:{inputDependencies:["type"]},getRunData:()=>{let S=V.size(l);return{outputs:[{dims:l,dataType:e.dataType}],dispatchGroup:{x:Math.ceil(d[1]/x),y:Math.ceil(d[0]/x)},programUniforms:[{type:12,data:S},...Pe(a,d)]}},getShaderSource:c}}return c=x=>{let S=Z("a",r,a.length),N=we("output",r,d.length);return`
  ${x.registerUniform("output_size","u32").declareVariables(S,N)}

  ${Id(s,n,S,N)}

  ${x.mainStart()}
    ${x.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

    let indices = ${N.offsetToIndices("global_idx")};
    let aIndices = perm(indices);

    ${N.setByOffset("global_idx",S.getByIndices("aIndices"))}
  }`},{name:"Transpose",shaderCache:{hint:`${t}`,inputDependencies:["rank"]},getRunData:()=>{let x=V.size(l);return{outputs:[{dims:l,dataType:e.dataType}],dispatchGroup:{x:Math.ceil(x/64)},programUniforms:[{type:12,data:x},...Pe(a,d)]}},getShaderSource:c}},_h=(e,t)=>{$d(e.inputs,t.perm),e.compute(Rt(e.inputs[0],t.perm))},vh=e=>Ze({perm:e.perm})}),uv=de(()=>{"use strict";Oe(),Me(),Re(),ua(),Li(),Pd={max:"select(bestValue, candidate, candidate > bestValue)",min:"select(bestValue, candidate, candidate < bestValue)",mean:"bestValue + candidate",sum:"bestValue + candidate",prod:"bestValue * candidate",sumSquare:"bestValue + candidate * candidate",logSumExp:"bestValue + exp(candidate)",l1:"bestValue + abs(candidate)",l2:"bestValue + candidate * candidate",logSum:"bestValue + candidate"},Ed={max:"select(bestValue, candidate, candidate > bestValue)",min:"select(bestValue, candidate, candidate < bestValue)",mean:"bestValue + candidate",sum:"bestValue + candidate",prod:"bestValue * candidate",sumSquare:"bestValue + candidate",logSumExp:"bestValue + candidate",l1:"bestValue + candidate",l2:"bestValue + candidate",logSum:"bestValue + candidate"},Ad={max:"_A[offset]",min:"_A[offset]",mean:"0",sum:"0",prod:"1",sumSquare:"0",logSumExp:"0",l1:"0",l2:"0",logSum:"0"},Od={max:"bestValue",min:"bestValue",sum:"bestValue",prod:"bestValue",sumSquare:"bestValue",logSumExp:"log(bestValue)",l1:"bestValue",l2:"sqrt(bestValue)",logSum:"log(bestValue)"},kd=(e,t)=>{let r=[];for(let n=t-e;n<t;++n)r.push(n);return r},Nd=(e,t)=>{let r=[],n=e.length;for(let l=0;l<n;l++)t.indexOf(l)===-1&&r.push(e[l]);let s=t.map(l=>e[l]);return[r,s]},Bd=(e,t)=>{let r=e.length+t.length,n=[],s=0;for(let l=0;l<r;l++)t.indexOf(l)===-1?n.push(e[s++]):n.push(1);return n},Ld=(e,t)=>{for(let r=0;r<e.length;++r)if(e[e.length-r-1]!==t-1-r)return!1;return!0},Md=(e,t)=>{let r=[];if(!Ld(e,t)){for(let n=0;n<t;++n)e.indexOf(n)===-1&&r.push(n);e.forEach(n=>r.push(n))}return r},Rd=(e,t,r,n,s,l,a)=>{let d=r[0].dims,p=V.size(l),c=V.size(a),g=Z("_A",r[0].dataType,d),_=we("output",s,l),w=64;p===1&&(w=256);let C=`
          var<workgroup> aBestValues : array<f32, ${w}>;
       `,x=S=>`
        ${S.registerUniform("reduceSize","u32").declareVariables(g,_)}
        ${C}
        fn DIV_CEIL(a : u32, b : u32) -> u32 {
          return ((a - 1u) / b + 1u);
         }
         ${S.mainStart(w)}

          let outputIndex = global_idx / ${w};
          let offset = outputIndex * uniforms.reduceSize;

          var bestValue = f32(${Ad[n]});
          let Length = uniforms.reduceSize;
          for (var k = local_idx; k < Length; k = k + ${w}) {
           let candidate = f32(${g.getByOffset("offset + k")});
           bestValue = ${Pd[n]};
          }
          aBestValues[local_idx] = bestValue;
          workgroupBarrier();

         var reduceSize = min(Length, ${w}u);
         for (var currentSize = reduceSize / 2u; reduceSize > 1u;
             currentSize = reduceSize / 2u) {
           let interval = DIV_CEIL(reduceSize, 2u);
           if (local_idx < currentSize) {
            let candidate = aBestValues[local_idx + interval];
            bestValue = ${Ed[n]};
            aBestValues[local_idx] = bestValue;
           }
           reduceSize = interval;
           workgroupBarrier();
         }

         if (local_idx == 0u) {
          ${_.setByOffset("outputIndex",`${n==="mean"?`${_.type.storage}(bestValue / f32(uniforms.reduceSize))`:`${_.type.storage}(${Od[n]})`}`)};
         }
        }`;return{name:e,shaderCache:{hint:`${t};${w}`,inputDependencies:["type"]},getShaderSource:x,getRunData:()=>({outputs:[{dims:l,dataType:s}],dispatchGroup:{x:p},programUniforms:[{type:12,data:c}]})}},Ht=(e,t,r,n)=>{let s=e.inputs.length===1?r:Do(e.inputs,r),l=s.axes;l.length===0&&!s.noopWithEmptyAxes&&(l=e.inputs[0].dims.map((C,x)=>x));let a=V.normalizeAxes(l,e.inputs[0].dims.length),d=a,p=e.inputs[0],c=Md(d,e.inputs[0].dims.length);c.length>0&&(p=e.compute(Rt(e.inputs[0],c),{inputs:[0],outputs:[-1]})[0],d=kd(d.length,p.dims.length));let[g,_]=Nd(p.dims,d),w=g;s.keepDims&&(w=Bd(g,a)),e.compute(Rd(t,s.cacheKey,[p],n,e.inputs[0].dataType,w,_),{inputs:[p]})},wh=(e,t)=>{Ht(e,"ReduceMeanShared",t,"mean")},bh=(e,t)=>{Ht(e,"ReduceL1Shared",t,"l1")},xh=(e,t)=>{Ht(e,"ReduceL2Shared",t,"l2")},$h=(e,t)=>{Ht(e,"ReduceLogSumExpShared",t,"logSumExp")},Ch=(e,t)=>{Ht(e,"ReduceMaxShared",t,"max")},Ih=(e,t)=>{Ht(e,"ReduceMinShared",t,"min")},Th=(e,t)=>{Ht(e,"ReduceProdShared",t,"prod")},Sh=(e,t)=>{Ht(e,"ReduceSumShared",t,"sum")},Ph=(e,t)=>{Ht(e,"ReduceSumSquareShared",t,"sumSquare")},Eh=(e,t)=>{Ht(e,"ReduceLogSumShared",t,"logSum")}}),ua=de(()=>{"use strict";Oe(),Me(),dt(),Re(),uv(),Vt=e=>{if(!e||e.length===0||e.length>2)throw new Error("Reduce op requires 1 or 2 inputs.");if(e.length===2&&e[1].dims.length!==1)throw new Error("Invalid axes input dims.")},Dd=e=>["","",`var value = ${e.getByIndices("input_indices")};`,""],En=(e,t,r,n,s,l,a=!1,d=!1)=>{let p=[],c=r[0].dims,g=c.length,_=V.normalizeAxes(s,g),w=!d&&_.length===0;c.forEach((S,N)=>{w||_.indexOf(N)>=0?a&&p.push(1):p.push(S)});let C=p.length,x=V.size(p);return{name:e,shaderCache:t,getShaderSource:S=>{let N=[],E=Z("_A",r[0].dataType,g),T=we("output",l,C),B=n(E,T,_),L=B[2];for(let M=0,F=0;M<g;M++)w||_.indexOf(M)>=0?(a&&F++,L=`for(var j${M}: u32 = 0; j${M} < ${c[M]}; j${M}++) {
                  ${B[2].includes("last_index")?`let last_index = j${M};`:""}
                  ${E.indicesSet("input_indices",M,`j${M}`)}
                  ${L}
                }`):(N.push(`${E.indicesSet("input_indices",M,T.indicesGet("output_indices",F))};`),F++);return`

        ${S.registerUniform("output_size","u32").declareVariables(E,T)}

        ${S.mainStart()}
          ${S.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
          var input_indices: ${E.type.indices};
          let output_indices = ${T.offsetToIndices("global_idx")};

          ${N.join(`
`)}
          ${B[0]}       // init ops for reduce max/min
          ${B[1]}
          ${L}
          ${B[3]}
          ${B.length===4?T.setByOffset("global_idx","value"):B.slice(4).join(`
`)}
        }`},getRunData:()=>({outputs:[{dims:p,dataType:l}],dispatchGroup:{x:Math.ceil(x/64)},programUniforms:[{type:12,data:x},...Pe(c,p)]})}},Do=(e,t)=>{let r=[];return e[1].dims[0]>0&&e[1].getBigInt64Array().forEach(n=>r.push(Number(n))),Ze({axes:r,keepDims:t.keepDims,noopWithEmptyAxes:t.noopWithEmptyAxes})},jt=(e,t,r,n)=>{let s=e.inputs,l=s.length===1?r:Do(s,r);e.compute(En(t,{hint:l.cacheKey,inputDependencies:["rank"]},[s[0]],l.noopWithEmptyAxes&&l.axes.length===0?Dd:n,l.axes,s[0].dataType,l.keepDims,l.noopWithEmptyAxes),{inputs:[0]})},zd=(e,t)=>{Vt(e.inputs),jt(e,"ReduceLogSum",t,(r,n)=>[`var value = ${n.type.storage}(0);`,"",`value += ${r.getByIndices("input_indices")};`,"value = log(value);"])},Fd=(e,t)=>{Vt(e.inputs),jt(e,"ReduceL1",t,(r,n)=>[`var value = ${n.type.storage}(0);`,"",`value += abs(${r.getByIndices("input_indices")});`,""])},Ud=(e,t)=>{Vt(e.inputs),jt(e,"ReduceL2",t,(r,n)=>[`var t = ${n.type.value}(0); var value = ${n.type.value}(0);`,"",`t = ${r.getByIndices("input_indices")}; value += (t * t);`,"value = sqrt(value);"])},qd=(e,t)=>{Vt(e.inputs),jt(e,"ReduceLogSumExp",t,(r,n)=>[`var value = ${n.type.storage}(0);`,"",`value += exp(${r.getByIndices("input_indices")});`,"value = log(value);"])},Wd=(e,t)=>{Vt(e.inputs),jt(e,"ReduceMax",t,(r,n,s)=>{let l=[];for(let a=0;a<r.rank;a++)(s.indexOf(a)>=0||s.length===0)&&l.push(r.indicesSet("input_indices",a,0));return[`${l.join(`
`)}`,`var value = ${r.getByIndices("input_indices")};`,`value = max(value, ${r.getByIndices("input_indices")});`,""]})},Xd=(e,t)=>{Vt(e.inputs),jt(e,"ReduceMean",t,(r,n,s)=>{let l=1;for(let a=0;a<r.rank;a++)(s.indexOf(a)>=0||s.length===0)&&(l*=e.inputs[0].dims[a]);return["var sum = f32(0);","",`sum += f32(${r.getByIndices("input_indices")});`,`let value = ${n.type.value}(sum / ${l});`]})},Yd=(e,t)=>{Vt(e.inputs),jt(e,"ReduceMin",t,(r,n,s)=>{let l=[];for(let a=0;a<r.rank;a++)(s.indexOf(a)>=0||s.length===0)&&l.push(`input_indices[${a}] = 0;`);return[`${l.join(`
`)}`,`var value = ${r.getByIndices("input_indices")};`,`value = min(value, ${r.getByIndices("input_indices")});`,""]})},Gd=(e,t)=>{Vt(e.inputs),jt(e,"ReduceProd",t,(r,n)=>[`var value = ${n.type.storage}(1);`,"",`value *= ${r.getByIndices("input_indices")};`,""])},Hd=(e,t)=>{Vt(e.inputs),jt(e,"ReduceSum",t,(r,n)=>[`var value = ${n.type.storage}(0);`,"",`value += ${r.getByIndices("input_indices")};`,""])},Vd=(e,t)=>{Vt(e.inputs),jt(e,"ReduceSumSquare",t,(r,n)=>[`var t = ${n.type.value}(0); var value = ${n.type.value}(0);`,"",`t = ${r.getByIndices("input_indices")}; value += t * t;`,""])},Kt=(e,t,r)=>{if(t.length===0)return r;let n=1,s=1;for(let l=0;l<t.length;l++)t.indexOf(l)===-1?n*=e[l]:s*=e[l];return s<32&&n>1024},Ah=(e,t)=>{Kt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?Xd(e,t):wh(e,t)},Oh=(e,t)=>{Kt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?Fd(e,t):bh(e,t)},kh=(e,t)=>{Kt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?Ud(e,t):xh(e,t)},Nh=(e,t)=>{Kt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?qd(e,t):$h(e,t)},Bh=(e,t)=>{Kt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?Wd(e,t):Ch(e,t)},Lh=(e,t)=>{Kt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?Yd(e,t):Ih(e,t)},Mh=(e,t)=>{Kt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?Gd(e,t):Th(e,t)},Rh=(e,t)=>{Kt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?Hd(e,t):Sh(e,t)},Dh=(e,t)=>{Kt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?Vd(e,t):Ph(e,t)},zh=(e,t)=>{Kt(e.inputs[0].dims,t.axes,t.noopWithEmptyAxes)?zd(e,t):Eh(e,t)}}),dv=de(()=>{"use strict";Oe(),dt(),ua(),Js=e=>{if(!e||e.length===0||e.length>2)throw new Error("ArgMinMaxOp op requires 1 or 2 inputs.");if(e[0].dataType!==1)throw new Error("Invalid input type.")},Fh=(e,t)=>{Js(e.inputs);let r=(n,s,l)=>{let a=[];for(let d=0;d<n.rank;d++)(l.indexOf(d)>=0||l.length===0)&&a.push(`input_indices[${d}] = 0;`);return[`${a.join(`
`)}`,`var value = ${n.getByIndices("input_indices")};
var best_index : i32 = 0;`,`if (${n.getByIndices("input_indices")} ${t.selectLastIndex>0?"<=":"<"} value) {
         value = ${n.getByIndices("input_indices")};
         best_index = i32(last_index);
       }`,"",s.setByOffset("global_idx","best_index")]};e.compute(En("ArgMin",{hint:t.cacheKey,inputDependencies:["rank"]},[e.inputs[0]],r,[t.axis],7,t.keepDims),{inputs:[0]})},Uh=(e,t)=>{Js(e.inputs);let r=(n,s,l)=>{let a=[];for(let d=0;d<n.rank;d++)(l.indexOf(d)>=0||l.length===0)&&a.push(`input_indices[${d}] = 0;`);return[`${a.join(`
`)}`,`var value = ${n.getByIndices("input_indices")};
var best_index : i32 = 0;`,`if (${n.getByIndices("input_indices")} ${t.selectLastIndex>0?">=":">"} value) {
         value = ${n.getByIndices("input_indices")};
         best_index = i32(last_index);
       }`,"",s.setByOffset("global_idx","best_index")]};e.compute(En("argMax",{hint:t.cacheKey,inputDependencies:["rank"]},[e.inputs[0]],r,[t.axis],7,t.keepDims),{inputs:[0]})},zo=e=>Ze(e)}),da=de(()=>{"use strict";Oe(),Me(),aa(),Re(),jd=(e,t)=>{let r=e[0],n=e[1],s=e[2],l=e[3],a=e[4],d=e[5];if(a&&d)throw new Error("Attention cannot have both past and attention_bias");if(r.dims.length!==3)throw new Error('Input "input" must have 3 dimensions');let p=r.dims[0],c=r.dims[1],g=r.dims[2];if(s.dims.length!==1)throw new Error('Input "bias" is expected to have 1 dimensions');if(n.dims.length!==2)throw new Error('Input "weights" is expected to have 2 dimensions');if(n.dims[0]!==g)throw new Error("Input 1 dimension 0 should have same length as dimension 2 of input 0");if(s.dims[0]!==n.dims[1])throw new Error('Input "bias" dimension 0 should have same length as dimension 1 of input "weights"');let _=s.dims[0]/3,w=_,C=w;if(t.qkvHiddenSizes.length>0){if(t.qkvHiddenSizes.length!==3)throw new Error("qkv_hidden_sizes attribute should have 3 elements");for(let B of t.qkvHiddenSizes)if(B%t.numHeads!==0)throw new Error("qkv_hidden_sizes should be divisible by num_heads");_=t.qkvHiddenSizes[0],w=t.qkvHiddenSizes[1],C=t.qkvHiddenSizes[2]}let x=c;if(_!==w)throw new Error("qkv_hidden_sizes first element should be same as the second");if(s.dims[0]!==_+w+C)throw new Error('Input "bias" dimension 0 should have same length as sum of Q/K/V hidden sizes');let S=0;if(a){if(w!==C)throw new Error('Input "past" expect k_hidden_size == v_hidden_size');if(a.dims.length!==5)throw new Error('Input "past" must have 5 dimensions');if(a.dims[0]!==2)throw new Error('Input "past" first dimension must be 2');if(a.dims[1]!==p)throw new Error('Input "past" second dimension must be batch_size');if(a.dims[2]!==t.numHeads)throw new Error('Input "past" third dimension must be num_heads');if(a.dims[4]!==w/t.numHeads)throw new Error('Input "past" fifth dimension must be k_hidden_size / num_heads');t.pastPresentShareBuffer||(S=a.dims[3])}let N=x+S,E=-1,T=0;if(l)throw new Error("Mask not supported");if(a)throw new Error("past is not supported");if(d){if(d.dims.length!==4)throw new Error('Input "attention_bias" must have 4 dimensions');if(d.dims[0]!==p||d.dims[1]!==t.numHeads||d.dims[2]!==c||d.dims[3]!==N)throw new Error('Expect "attention_bias" shape (batch_size, num_heads, sequence_length, total_sequence_length)')}return{batchSize:p,sequenceLength:c,pastSequenceLength:S,kvSequenceLength:x,totalSequenceLength:N,maxSequenceLength:E,inputHiddenSize:g,hiddenSize:_,vHiddenSize:C,headSize:Math.floor(_/t.numHeads),vHeadSize:Math.floor(C/t.numHeads),numHeads:t.numHeads,isUnidirectional:!1,pastPresentShareBuffer:!1,maskFilterValue:t.maskFilterValue,maskType:T,scale:t.scale,broadcastResPosBias:!1,passPastInKv:!1,qkvFormat:1}},gn=(e,t,r)=>t&&e?`
      let total_sequence_length_input = u32(${t.getByOffset("0")});
      let present_sequence_length = max(total_sequence_length_input, uniforms.past_sequence_length);
      let is_subsequent_prompt: bool = sequence_length > 1 && sequence_length != total_sequence_length_input;
      let is_first_prompt: bool = is_subsequent_prompt == false && sequence_length == total_sequence_length_input;
      total_sequence_length = u32(${e?.getByOffset("batchIdx")}) + 1;
      var past_sequence_length: u32 = 0;
      if (is_first_prompt == false) {
        past_sequence_length = total_sequence_length - sequence_length;
      }
       `:`
    ${r?"let past_sequence_length = uniforms.past_sequence_length":""};
    let present_sequence_length = total_sequence_length;
    `,Kd=(e,t,r,n,s,l,a,d)=>{let p=ut(a?1:l),c=64,g=l/p;g<c&&(c=32);let _=Math.ceil(l/p/c),w=[{type:12,data:t},{type:12,data:r},{type:12,data:n},{type:12,data:s},{type:12,data:g},{type:12,data:_}],C=ht(e.dataType,p),x=ft(1,p),S=["type"];a&&S.push("type"),d&&S.push("type");let N=E=>{let T=we("x",e.dataType,e.dims,p),B=[T],L=a?Z("seq_lens",a.dataType,a.dims):void 0;L&&B.push(L);let M=d?Z("total_sequence_length_input",d.dataType,d.dims):void 0;M&&B.push(M);let F=ft(e.dataType),U=[{name:"batch_size",type:"u32"},{name:"num_heads",type:"u32"},{name:"past_sequence_length",type:"u32"},{name:"sequence_length",type:"u32"},{name:"total_sequence_length",type:"u32"},{name:"elements_per_thread",type:"u32"}];return`
  var<workgroup> thread_max: array<f32, ${c}>;
  var<workgroup> thread_sum: array<f32, ${c}>;
  ${E.registerUniforms(U).declareVariables(...B)}
  ${E.mainStart([c,1,1])}
    let batchIdx = workgroup_id.z / uniforms.num_heads;
    let headIdx = workgroup_id.z % uniforms.num_heads;
    let sequence_length = uniforms.sequence_length;
    var total_sequence_length = uniforms.total_sequence_length;
    ${gn(L,M,!1)}
    let local_offset = local_idx * uniforms.elements_per_thread;
    let offset = (global_idx / ${c}) * uniforms.total_sequence_length + local_offset;
    let seq_causal_length = ${a?"u32(past_sequence_length + workgroup_id.y + 1)":"total_sequence_length"};
    var thread_max_vector = ${x}(-3.4028234663852886e+38f);
    for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
      thread_max_vector = max(${x}(x[offset + i]), thread_max_vector);
    }
    thread_max[local_idx] = ${(()=>{switch(p){case 1:return"thread_max_vector";case 2:return"max(thread_max_vector.x, thread_max_vector.y)";case 4:return"max(max(thread_max_vector.x, thread_max_vector.y), max(thread_max_vector.z, thread_max_vector.w))";default:throw new Error(`Unsupported components: ${p}`)}})()};
    workgroupBarrier();

    var max_value =  f32(-3.4028234663852886e+38f);
    for (var i = 0u; i < ${c}; i++) {
      max_value = max(thread_max[i], max_value);
    }

    var sum_vector = ${x}(0);
    for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
      sum_vector += exp(${x}(x[offset + i]) - max_value);
    }
    thread_sum[local_idx] = ${(()=>{switch(p){case 1:return"sum_vector";case 2:return"sum_vector.x + sum_vector.y";case 4:return"sum_vector.x + sum_vector.y + sum_vector.z + sum_vector.w";default:throw new Error(`Unsupported components: ${p}`)}})()};
    workgroupBarrier();

    var sum: f32 = 0;
    for (var i = 0u; i < ${c}; i++) {
      sum += thread_sum[i];
    }

    if (sum == 0) {
      for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
        x[offset + i] = ${T.type.value}(${F}(1.0) / ${F}(seq_causal_length));
      }
    } else {
      for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
        var f32input = ${x}(x[offset + i]);
        x[offset + i] = ${T.type.value}(exp(f32input - max_value) / sum);
      }
    }
      ${a?`
        for (var total_seq_id: u32 = seq_causal_length; total_seq_id + local_offset < uniforms.total_sequence_length; total_seq_id++) {
          x[offset + total_seq_id] = ${T.type.value}(${F}(0));
        }`:""};
  }`};return{name:"AttentionProbsSoftmax",shaderCache:{hint:`${c};${C};${p}`,inputDependencies:S},getShaderSource:N,getRunData:()=>({outputs:[],dispatchGroup:{x:1,y:s,z:t*r},programUniforms:w})}},Zd=(e,t,r,n,s,l,a,d,p)=>{let c=a+l.kvSequenceLength,g=[l.batchSize,l.numHeads,l.sequenceLength,c],_=e>1&&n,w=l.kvNumHeads?l.kvNumHeads:l.numHeads,C=_?[l.batchSize,w,c,l.headSize]:void 0,x=l.nReps?l.nReps:1,S=l.scale===0?1/Math.sqrt(l.headSize):l.scale,N=ut(l.headSize),E=l.headSize/N,T=12,B={x:Math.ceil(c/T),y:Math.ceil(l.sequenceLength/T),z:l.batchSize*l.numHeads},L=[{type:12,data:l.sequenceLength},{type:12,data:E},{type:12,data:c},{type:12,data:l.numHeads},{type:12,data:l.headSize},{type:1,data:S},{type:12,data:a},{type:12,data:l.kvSequenceLength},{type:12,data:x}],M=_&&n&&V.size(n.dims)>0,F=["type","type"];M&&F.push("type"),s&&F.push("type"),d&&F.push("type"),p&&F.push("type");let U=[{dims:g,dataType:t.dataType,gpuDataType:0}];_&&U.push({dims:C,dataType:t.dataType,gpuDataType:0});let k=re=>{let oe=Z("q",t.dataType,t.dims,N),ye=Z("key",r.dataType,r.dims,N),fe=[oe,ye];if(M){let be=Z("past_key",n.dataType,n.dims,N);fe.push(be)}s&&fe.push(Z("attention_bias",s.dataType,s.dims));let ce=d?Z("seq_lens",d.dataType,d.dims):void 0;ce&&fe.push(ce);let $e=p?Z("total_sequence_length_input",p.dataType,p.dims):void 0;$e&&fe.push($e);let q=we("output",t.dataType,g),Y=[q];_&&Y.push(we("present_key",t.dataType,C,N));let Ie=ft(1,N),Te=[{name:"M",type:"u32"},{name:"K",type:"u32"},{name:"N",type:"u32"},{name:"num_heads",type:"u32"},{name:"head_size",type:"u32"},{name:"alpha",type:"f32"},{name:"past_sequence_length",type:"u32"},{name:"kv_sequence_length",type:"u32"},{name:"n_reps",type:"u32"}];return`
  const TILE_SIZE = ${T}u;

  var<workgroup> tileQ: array<${oe.type.storage}, ${T*T}>;
  var<workgroup> tileK: array<${oe.type.storage}, ${T*T}>;
  ${re.registerUniforms(Te).declareVariables(...fe,...Y)}
  ${re.mainStart([T,T,1])}
    // x holds the N and y holds the M
    let headIdx = workgroup_id.z % uniforms.num_heads;
    let kvHeadIdx = ${x===1?"headIdx":"headIdx / uniforms.n_reps"};
    let kv_num_heads = ${x===1?"uniforms.num_heads":"uniforms.num_heads / uniforms.n_reps"};
    let batchIdx = workgroup_id.z / uniforms.num_heads;
    let m = workgroup_id.y * TILE_SIZE;
    let n = workgroup_id.x * TILE_SIZE;
    let sequence_length = uniforms.M;
    var total_sequence_length = uniforms.N;
    ${gn(ce,$e,!0)}
    let absKvHeadIdx = batchIdx * kv_num_heads + kvHeadIdx;
    let qOffset = workgroup_id.z * uniforms.M * uniforms.K + m * uniforms.K;
    ${M&&_?"let pastKeyOffset = absKvHeadIdx * uniforms.past_sequence_length * uniforms.K;":""};
    let kOffset = absKvHeadIdx * uniforms.kv_sequence_length * uniforms.K;
    ${_?"let presentKeyOffset = absKvHeadIdx * uniforms.N * uniforms.K;":""}
    var value = ${Ie}(0);
    for (var w: u32 = 0u; w < uniforms.K; w += TILE_SIZE) {
      if (global_id.y < uniforms.M && w + local_id.x < uniforms.K) {
        tileQ[TILE_SIZE * local_id.y + local_id.x] = q[qOffset + local_id.y * uniforms.K + w + local_id.x];
      }
      if (n + local_id.y < uniforms.N && w + local_id.x < uniforms.K) {
        var idx = TILE_SIZE * local_id.y + local_id.x;
      ${M&&_?`
              if (n + local_id.y < past_sequence_length) {
                tileK[idx] = past_key[pastKeyOffset + (n + local_id.y) * uniforms.K + w + local_id.x];
              } else if (n + local_id.y - past_sequence_length < uniforms.kv_sequence_length) {
                tileK[idx] = key[kOffset + (n + local_id.y - past_sequence_length) * uniforms.K + w + local_id.x];
              }`:`
          if (n + local_id.y < uniforms.kv_sequence_length) {
            tileK[idx] = key[kOffset + (n + local_id.y) * uniforms.K + w + local_id.x];
          }`}
      ${_?`if (n + local_id.y < present_sequence_length) {
        present_key[presentKeyOffset + (n + local_id.y) * uniforms.K + w + local_id.x] = tileK[idx];
      }`:""}
      }
      workgroupBarrier();

      for (var k: u32 = 0u; k < TILE_SIZE && w+k < uniforms.K; k++) {
          value += ${Ie}(tileQ[TILE_SIZE * local_id.y + k] * tileK[TILE_SIZE * local_id.x + k]);
      }

      workgroupBarrier();
    }

    if (global_id.y < uniforms.M && global_id.x < total_sequence_length) {
      let headOffset = workgroup_id.z * uniforms.M * uniforms.N;
      let outputIdx = headOffset + global_id.y * uniforms.N + global_id.x;
      var sum: f32 = ${(()=>{switch(N){case 1:return"value";case 2:return"value.x + value.y";case 4:return"value.x + value.y + value.z + value.w";default:throw new Error(`Unsupported components: ${N}`)}})()};
        output[outputIdx] = ${q.type.value} (sum * uniforms.alpha) + ${s?"attention_bias[outputIdx]":"0.0"};
    }
  }`};return{name:"AttentionProbs",shaderCache:{hint:`${N};${s!==void 0};${n!==void 0};${e}`,inputDependencies:F},getRunData:()=>({outputs:U,dispatchGroup:B,programUniforms:L}),getShaderSource:k}},Jd=(e,t,r,n,s,l,a=void 0,d=void 0)=>{let p=l+s.kvSequenceLength,c=s.nReps?s.nReps:1,g=s.vHiddenSize*c,_=e>1&&n,w=s.kvNumHeads?s.kvNumHeads:s.numHeads,C=_?[s.batchSize,w,p,s.headSize]:void 0,x=[s.batchSize,s.sequenceLength,g],S=12,N={x:Math.ceil(s.vHeadSize/S),y:Math.ceil(s.sequenceLength/S),z:s.batchSize*s.numHeads},E=[{type:12,data:s.sequenceLength},{type:12,data:p},{type:12,data:s.vHeadSize},{type:12,data:s.numHeads},{type:12,data:s.headSize},{type:12,data:g},{type:12,data:l},{type:12,data:s.kvSequenceLength},{type:12,data:c}],T=_&&n&&V.size(n.dims)>0,B=["type","type"];T&&B.push("type"),a&&B.push("type"),d&&B.push("type");let L=[{dims:x,dataType:t.dataType,gpuDataType:0}];_&&L.push({dims:C,dataType:t.dataType,gpuDataType:0});let M=F=>{let U=Z("probs",t.dataType,t.dims),k=Z("v",r.dataType,r.dims),re=[U,k];T&&re.push(Z("past_value",n.dataType,n.dims));let oe=a?Z("seq_lens",a.dataType,a.dims):void 0;a&&re.push(oe);let ye=d?Z("total_sequence_length_input",d.dataType,d.dims):void 0;d&&re.push(ye);let fe=[we("output",t.dataType,x)];_&&fe.push(we("present_value",t.dataType,C));let ce=[{name:"M",type:"u32"},{name:"K",type:"u32"},{name:"N",type:"u32"},{name:"num_heads",type:"u32"},{name:"head_size",type:"u32"},{name:"v_hidden_size",type:"u32"},{name:"past_sequence_length",type:"u32"},{name:"kv_sequence_length",type:"u32"},{name:"n_reps",type:"u32"}];return`
  const TILE_SIZE = ${S}u;
  var<workgroup> tileQ: array<${U.type.value}, ${S*S}>;
  var<workgroup> tileV: array<${U.type.value}, ${S*S}>;
  ${F.registerUniforms(ce).declareVariables(...re,...fe)}
  ${F.mainStart([S,S,1])}
   let headIdx = workgroup_id.z % uniforms.num_heads;
   let batchIdx = workgroup_id.z / uniforms.num_heads;
   let kvHeadIdx = ${c===1?"headIdx":"headIdx / uniforms.n_reps"};
   let kv_num_heads = ${c===1?"uniforms.num_heads":"uniforms.num_heads / uniforms.n_reps"};
   let m = global_id.y;
   let n = global_id.x;
   let sequence_length = uniforms.M;
   var total_sequence_length = uniforms.K;
   ${gn(oe,ye,!0)}
   let offsetA = workgroup_id.z * uniforms.M * uniforms.K + m * uniforms.K;
   let absKvHeadIdx = batchIdx * kv_num_heads + kvHeadIdx; // kvHeadIdx is relative to the batch
   ${T&&_?"let pastValueOffset = absKvHeadIdx * uniforms.N * uniforms.past_sequence_length + n;":""};
   let vOffset = absKvHeadIdx * uniforms.N * uniforms.kv_sequence_length + n;
   ${_?"let presentValueOffset = absKvHeadIdx * uniforms.N * uniforms.K + n;":""}
   var value = ${U.type.storage}(0);
   for (var w: u32 = 0u; w < uniforms.K; w += TILE_SIZE) {
      if (m < uniforms.M && w + local_id.x < uniforms.K) {
        tileQ[TILE_SIZE * local_id.y + local_id.x] = probs[offsetA + w + local_id.x];
      }
      if (n < uniforms.N && w + local_id.y < uniforms.K) {
        var idx = TILE_SIZE * local_id.y + local_id.x;
        ${T&&_?`
        if (w + local_id.y < past_sequence_length) {
          tileV[idx] = past_value[pastValueOffset + (w + local_id.y) * uniforms.N];
        } else if (w + local_id.y - past_sequence_length < uniforms.kv_sequence_length) {
          tileV[idx] = v[vOffset + (w + local_id.y - past_sequence_length) * uniforms.N];
        }
      `:`
            if (w + local_id.y < uniforms.kv_sequence_length) {
              tileV[idx] = v[vOffset + (w + local_id.y) * uniforms.N];
            }`}
        ${_?`
            if (w + local_id.y < present_sequence_length) {
          present_value[presentValueOffset + (w + local_id.y) * uniforms.N] = tileV[idx];
        }`:""}
      }
     workgroupBarrier();
     for (var k: u32 = 0u; k < TILE_SIZE && w+k < total_sequence_length; k++) {
       value += tileQ[TILE_SIZE * local_id.y + k] * tileV[TILE_SIZE * k + local_id.x];
     }
     workgroupBarrier();
   }

   // we need to transpose output from BNSH_v to BSND_v
   if (m < uniforms.M && n < uniforms.N) {
     let outputIdx = batchIdx * uniforms.M * uniforms.v_hidden_size + m * uniforms.v_hidden_size
       + headIdx * uniforms.N + n;
     output[outputIdx] = value;
   }
  }`};return{name:"AttentionScore",shaderCache:{hint:`${n!==void 0};${e}`,inputDependencies:B},getRunData:()=>({outputs:L,dispatchGroup:N,programUniforms:E}),getShaderSource:M}},Mr=(e,t,r,n,s,l,a,d,p,c,g=void 0,_=void 0)=>{let w=Math.min(e.outputCount,1+(a?1:0)+(d?1:0)),C=w>1?a:void 0,x=w>1?d:void 0,S=w>1?c.pastSequenceLength:0,N=S+c.kvSequenceLength,E=p&&V.size(p.dims)>0?p:void 0,T=[t,r];C&&V.size(C.dims)>0&&T.push(C),E&&T.push(E),g&&T.push(g),_&&T.push(_);let B=e.compute(Zd(w,t,r,C,E,c,S,g,_),{inputs:T,outputs:w>1?[-1,1]:[-1]})[0];e.compute(Kd(B,c.batchSize,c.numHeads,S,c.sequenceLength,N,g,_),{inputs:g&&_?[B,g,_]:[B],outputs:[]});let L=[B,n];x&&V.size(x.dims)>0&&L.push(x),g&&L.push(g),_&&L.push(_),e.compute(Jd(w,B,n,x,c,S,g,_),{inputs:L,outputs:w>1?[0,2]:[0]})},Qd=(e,t)=>{let r=[t.batchSize,t.numHeads,t.sequenceLength,t.headSize],n=t.sequenceLength,s=t.inputHiddenSize,l=t.headSize,a=12,d={x:Math.ceil(t.headSize/a),y:Math.ceil(t.sequenceLength/a),z:t.batchSize*t.numHeads},p=[e.inputs[0],e.inputs[1],e.inputs[2]],c=[{type:12,data:n},{type:12,data:s},{type:12,data:l},{type:12,data:t.numHeads},{type:12,data:t.headSize},{type:12,data:t.hiddenSize},{type:12,data:t.hiddenSize+t.hiddenSize+t.vHiddenSize}],g=_=>{let w=we("output_q",p[0].dataType,r),C=we("output_k",p[0].dataType,r),x=we("output_v",p[0].dataType,r),S=Z("input",p[0].dataType,p[0].dims),N=Z("weight",p[1].dataType,p[1].dims),E=Z("bias",p[2].dataType,p[2].dims),T=S.type.storage,B=[{name:"M",type:"u32"},{name:"K",type:"u32"},{name:"N",type:"u32"},{name:"num_heads",type:"u32"},{name:"head_size",type:"u32"},{name:"hidden_size",type:"u32"},{name:"ldb",type:"u32"}];return`
  const TILE_SIZE = ${a}u;
  var<workgroup> tileInput: array<${T}, ${a*a}>;
  var<workgroup> tileWeightQ: array<${T}, ${a*a}>;
  var<workgroup> tileWeightK: array<${T}, ${a*a}>;
  var<workgroup> tileWeightV: array<${T}, ${a*a}>;
  ${_.registerUniforms(B).declareVariables(S,N,E,w,C,x)}
  ${_.mainStart([a,a,1])}
    let batchIndex = workgroup_id.z / uniforms.num_heads;
    let headNumber = workgroup_id.z % uniforms.num_heads;
    let m = global_id.y;
    let n = global_id.x;

    let inputOffset = batchIndex * (uniforms.M * uniforms.K) + m * uniforms.K;
    let biasOffsetQ = headNumber * uniforms.head_size;
    let biasOffsetK = uniforms.hidden_size + biasOffsetQ;
    let biasOffsetV = uniforms.hidden_size + biasOffsetK;

    var valueQ = ${T}(0);
    var valueK = ${T}(0);
    var valueV = ${T}(0);
    for (var w: u32 = 0u; w < uniforms.K; w += TILE_SIZE) {
      if (m < uniforms.M && w + local_id.x < uniforms.K) {
        tileInput[TILE_SIZE * local_id.y + local_id.x] = input[inputOffset + w + local_id.x];
      }
      if (n < uniforms.N && w + local_id.y < uniforms.K) {
        let offset = n + (w + local_id.y) * uniforms.ldb;
        tileWeightQ[TILE_SIZE * local_id.y + local_id.x] = weight[biasOffsetQ + offset];
        tileWeightK[TILE_SIZE * local_id.y + local_id.x] = weight[biasOffsetK + offset];
        tileWeightV[TILE_SIZE * local_id.y + local_id.x] = weight[biasOffsetV + offset];
      }
      workgroupBarrier();
      for (var k: u32 = 0u; k<TILE_SIZE && w+k < uniforms.K; k++) {
        let inputTileOffset = TILE_SIZE * local_id.y + k;
        let weightTileOffset = TILE_SIZE * k + local_id.x;
        valueQ += tileInput[inputTileOffset] * tileWeightQ[weightTileOffset];
        valueK += tileInput[inputTileOffset] * tileWeightK[weightTileOffset];
        valueV += tileInput[inputTileOffset] * tileWeightV[weightTileOffset];
      }

      workgroupBarrier();
    }

    let headOffset = (m * uniforms.N + n) % uniforms.head_size;
    valueQ += bias[headOffset + biasOffsetQ];
    valueK += bias[headOffset + biasOffsetK];
    valueV += bias[headOffset + biasOffsetV];

    let offset = workgroup_id.z * uniforms.M * uniforms.N;
    if (m < uniforms.M && n < uniforms.N) {
      let outputIdx = offset + m * uniforms.N + n;
      output_q[outputIdx] = valueQ;
      output_k[outputIdx] = valueK;
      output_v[outputIdx] = valueV;
    }
  }`};return e.compute({name:"AttentionPrepare",shaderCache:{inputDependencies:["type","type","type"]},getRunData:()=>({outputs:[{dims:r,dataType:e.inputs[0].dataType,gpuDataType:0},{dims:r,dataType:e.inputs[0].dataType,gpuDataType:0},{dims:r,dataType:e.inputs[0].dataType,gpuDataType:0}],dispatchGroup:d,programUniforms:c}),getShaderSource:g},{inputs:p,outputs:[-1,-1,-1]})},qh=(e,t)=>{let r=jd(e.inputs,t),[n,s,l]=Qd(e,r);return Mr(e,n,s,l,e.inputs[4],void 0,void 0,void 0,e.inputs[5],r)}}),pv=de(()=>{"use strict";Wt(),Oe(),Me(),dt(),Re(),ep=(e,t)=>{if(!e||e.length!==5)throw new Error("BatchNormalization requires 5 inputs");let r=(n,s,l)=>{let a=s.length;if(a!==n.length)throw new Error(`${l}: num dimensions != ${a}`);s.forEach((d,p)=>{if(d!==n[p])throw new Error(`${l}: dim[${p}] do not match`)})};if(e[0].dims.length>1){let n=t.format==="NHWC"?t.spatial?e[0].dims.slice(-1):e[0].dims.slice(-1).concat(e[0].dims.slice(1,e[0].dims.length-1)):e[0].dims.slice(1,t.spatial?2:void 0);r(e[1].dims,n,"Invalid input scale"),r(e[2].dims,n,"Invalid input B"),r(e[3].dims,n,"Invalid input mean"),r(e[4].dims,n,"Invalid input var")}else r(e[1].dims,[1],"Invalid input scale"),r(e[2].dims,[1],"Invalid input B"),r(e[3].dims,[1],"Invalid input mean"),r(e[4].dims,[1],"Invalid input var")},tp=(e,t)=>{let{epsilon:r,spatial:n,format:s}=t,l=e[0].dims,a=n?ut(l[l.length-1]):1,d=s==="NHWC"&&l.length>1?a:1,p=V.size(l)/a,c=n,g=c?l.length:l,_=Z("x",e[0].dataType,e[0].dims,a),w=Z("scale",e[1].dataType,e[1].dims,d),C=Z("bias",e[2].dataType,e[2].dims,d),x=Z("inputMean",e[3].dataType,e[3].dims,d),S=Z("inputVar",e[4].dataType,e[4].dims,d),N=we("y",e[0].dataType,g,a),E=()=>{let B="";if(n)B=`let cOffset = ${l.length===1?"0u":s==="NHWC"?`outputIndices[${l.length-1}] / ${a}`:"outputIndices[1]"};`;else if(s==="NCHW")B=`
            ${N.indicesSet("outputIndices","0","0")}
            let cOffset = ${N.indicesToOffset("outputIndices")};`;else{B=`var cIndices = ${w.type.indices}(0);
                       cIndices[0] = outputIndices[${l.length-1}];`;for(let L=1;L<w.rank;L++)B+=`cIndices[${L}] = outputIndices[${L}];`;B+=`let cOffset = ${w.indicesToOffset("cIndices")};`}return B},T=B=>`
  const epsilon = ${r};
  ${B.registerUniform("outputSize","u32").declareVariables(_,w,C,x,S,N)}
  ${B.mainStart()}
  ${B.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
    var outputIndices = ${N.offsetToIndices(`global_idx * ${a}`)};
    ${E()}
    let scale = ${w.getByOffset("cOffset")};
    let bias = ${C.getByOffset("cOffset")};
    let inputMean = ${x.getByOffset("cOffset")};
    let inputVar = ${S.getByOffset("cOffset")};
    let x = ${_.getByOffset("global_idx")};
    let value = (x - inputMean) * inverseSqrt(inputVar + epsilon) * scale + bias;
    ${N.setByOffset("global_idx","value")}
  }`;return{name:"BatchNormalization",shaderCache:{hint:`${t.epsilon}_${t.format}_${n}_${a}`,inputDependencies:c?["rank","type","type","type","type"]:void 0},getShaderSource:T,getRunData:()=>({outputs:[{dims:e[0].dims,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(p/64)},programUniforms:c?[{type:12,data:p},...Pe(l)]:[{type:12,data:p}]})}},ip=e=>Ze(e),Wh=(e,t)=>{let{inputs:r,outputCount:n}=e,s=ip({...t,outputCount:n});if(lt.webgpu.validateInputContent&&ep(r,s),t.trainingMode)throw new Error("BatchNormalization trainingMode is not supported yet.");e.compute(tp(r,s))}}),cv=de(()=>{"use strict";Me(),Re(),rp=e=>{if(e[0].dims.length!==3)throw new Error("input should have 3 dimensions");if(![320,640,1280].includes(e[0].dims[2]))throw new Error("number of channels should be 320, 640 or 1280");if(e[1].dims.length!==1)throw new Error("bias is expected to have 1 dimensions");if(e[0].dims[2]!==e[1].dims[0])throw new Error("last dimension of input and bias are not the same")},np=e=>{let t=e[0].dims,r=e[0].dims[2],n=V.size(t)/4,s=e[0].dataType,l=Z("input",s,t,4),a=Z("bias",s,[r],4),d=Z("residual",s,t,4),p=we("output",s,t,4);return{name:"BiasAdd",getRunData:()=>({outputs:[{dims:t,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(n/64)}}),getShaderSource:c=>`
  const channels = ${r}u / 4;
  ${c.declareVariables(l,a,d,p)}

  ${c.mainStart()}
    ${c.guardAgainstOutOfBoundsWorkgroupSizes(n)}
    let value = ${l.getByOffset("global_idx")}
      + ${a.getByOffset("global_idx % channels")} + ${d.getByOffset("global_idx")};
    ${p.setByOffset("global_idx","value")}
  }`}},Xh=e=>{rp(e.inputs),e.compute(np(e.inputs))}}),pa=de(()=>{"use strict";Oe(),Me(),dt(),Re(),sp=(e,t,r,n,s,l,a)=>{let d=Math.ceil(t/4),p="";typeof s=="string"?p=`${s}(a)`:p=s("a");let c=Z("inputData",r,[d],4),g=we("outputData",n,[d],4),_=[{name:"vec_size",type:"u32"}];return a&&_.push(...a),`
      ${e.registerUniforms(_).declareVariables(c,g)}

  ${l??""}

  ${e.mainStart()}
    ${e.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}

    let a = ${c.getByOffset("global_idx")};
    ${g.setByOffset("global_idx",p)}
  }`},Ke=(e,t,r,n,s,l=e.dataType,a,d)=>{let p=[{type:12,data:Math.ceil(V.size(e.dims)/4)}];return a&&p.push(...a),{name:t,shaderCache:{hint:s,inputDependencies:["type"]},getShaderSource:c=>sp(c,V.size(e.dims),e.dataType,l,r,n,d),getRunData:c=>({outputs:[{dims:e.dims,dataType:l}],dispatchGroup:{x:Math.ceil(V.size(c[0].dims)/64/4)},programUniforms:p})}},Yh=e=>{e.compute(Ke(e.inputs[0],"Abs","abs"))},Gh=e=>{e.compute(Ke(e.inputs[0],"Acos","acos"))},Hh=e=>{e.compute(Ke(e.inputs[0],"Acosh","acosh"))},Vh=e=>{e.compute(Ke(e.inputs[0],"Asin","asin"))},jh=e=>{e.compute(Ke(e.inputs[0],"Asinh","asinh"))},Kh=e=>{e.compute(Ke(e.inputs[0],"Atan","atan"))},Zh=e=>{e.compute(Ke(e.inputs[0],"Atanh","atanh"))},Jh=e=>Ze(e),Qh=(e,t)=>{let r;switch(t.to){case 10:r="vec4<f16>";break;case 1:r="vec4<f32>";break;case 12:r="vec4<u32>";break;case 6:r="vec4<i32>";break;case 9:r="vec4<bool>";break;default:throw new RangeError(`not supported type (specified in attribute 'to' from 'Cast' operator): ${t.to}`)}e.compute(Ke(e.inputs[0],"Cast",r,void 0,t.cacheKey,t.to))},op=e=>{let t,r,n=e.length>=2&&e[1].data!==0,s=e.length>=3&&e[2].data!==0;switch(e[0].dataType){case 1:t=n?e[1].getFloat32Array()[0]:-34028234663852886e22,r=s?e[2].getFloat32Array()[0]:34028234663852886e22;break;case 10:t=n?e[1].getUint16Array()[0]:64511,r=s?e[2].getUint16Array()[0]:31743;break;default:throw new Error("Unsupport data type")}return Ze({min:t,max:r})},em=(e,t)=>{let r=t||op(e.inputs),n=ft(e.inputs[0].dataType);e.compute(Ke(e.inputs[0],"Clip",s=>`clamp(${s}, vec4<${n}>(uniforms.min), vec4<${n}>(uniforms.max))`,void 0,r.cacheKey,void 0,[{type:e.inputs[0].dataType,data:r.min},{type:e.inputs[0].dataType,data:r.max}],[{name:"min",type:n},{name:"max",type:n}]),{inputs:[0]})},tm=e=>{e.compute(Ke(e.inputs[0],"Ceil","ceil"))},im=e=>{e.compute(Ke(e.inputs[0],"Cos","cos"))},rm=e=>{e.compute(Ke(e.inputs[0],"Cosh","cosh"))},Or=e=>Ze(e),nm=(e,t)=>{let r=ft(e.inputs[0].dataType);e.compute(Ke(e.inputs[0],"Elu",n=>`elu_vf32(${n})`,`
  const elu_alpha_ = ${r}(${t.alpha});

  fn elu_f32(a: ${r}) -> ${r} {
  return select((exp(a) - 1.0) * elu_alpha_, a, a >= 0.0);
  }

  fn elu_vf32(v: vec4<${r}>) -> vec4<${r}> {
  return vec4(elu_f32(v.x), elu_f32(v.y), elu_f32(v.z), elu_f32(v.w));
  }`,t.cacheKey))},In=(e="f32")=>`
const r0: ${e} = 0.3275911;
const r1: ${e} = 0.254829592;
const r2: ${e} = -0.284496736;
const r3: ${e} = 1.421413741;
const r4: ${e} = -1.453152027;
const r5: ${e} = 1.061405429;

fn erf_vf32(v: vec4<${e}>) -> vec4<${e}> {
  let absv = abs(v);
  let x = 1.0 / (1.0 + r0 * absv);
  return sign(v) * (1.0 - ((((r5 * x + r4) * x + r3) * x + r2) * x + r1) * x * exp(-absv * absv));
}`,sm=e=>{let t=ft(e.inputs[0].dataType);e.compute(Ke(e.inputs[0],"Erf",r=>`erf_vf32(${r})`,In(t)))},om=e=>{e.compute(Ke(e.inputs[0],"Exp","exp"))},am=e=>{e.compute(Ke(e.inputs[0],"Floor","floor"))},lm=e=>{let t=ft(e.inputs[0].dataType);e.compute(Ke(e.inputs[0],"Gelu",r=>`0.5 * ${r} * (1.0 + erf_vf32(${r} * 0.7071067811865475))`,In(t)))},um=(e,t)=>{let r=ft(e.inputs[0].dataType);e.compute(Ke(e.inputs[0],"LeakyRelu",n=>`select(leaky_relu_alpha_ * ${n}, ${n}, ${n} >= vec4<${r}>(0.0))`,`const leaky_relu_alpha_ = ${r}(${t.alpha});`,t.cacheKey))},dm=e=>{e.compute(Ke(e.inputs[0],"Not",t=>`!${t}`))},pm=e=>{e.compute(Ke(e.inputs[0],"Neg",t=>`-${t}`))},cm=e=>{e.compute(Ke(e.inputs[0],"Reciprocal",t=>`1.0/${t}`))},fm=e=>{let t=ft(e.inputs[0].dataType);e.compute(Ke(e.inputs[0],"Relu",r=>`select(vec4<${t}>(0.0), ${r}, ${r} > vec4<${t}>(0.0))`))},hm=e=>{e.compute(Ke(e.inputs[0],"Sigmoid",t=>`(1.0 / (1.0 + exp(-${t})))`))},mm=e=>Ze(e),gm=(e,t)=>{let r=ft(e.inputs[0].dataType);e.compute(Ke(e.inputs[0],"HardSigmoid",n=>`max(vec4<${r}>(0.0), min(vec4<${r}>(1.0), ${t.alpha} * ${n} + vec4<${r}>(${t.beta})))`,void 0,t.cacheKey))},ym=e=>{let t=ft(e.inputs[0].dataType);e.compute(Ke(e.inputs[0],"HardSwish",r=>`${r} * max(vec4<${t}>(0.0), min(vec4<${t}>(1.0), vec4<${t}>(${t}(1.0 / 6.0)) * ${r} + vec4<${t}>(0.5)))`))},_m=e=>{e.compute(Ke(e.inputs[0],"Sin","sin"))},vm=e=>{e.compute(Ke(e.inputs[0],"Sinh","sinh"))},wm=e=>{e.compute(Ke(e.inputs[0],"Sqrt","sqrt"))},bm=e=>{e.compute(Ke(e.inputs[0],"Tan","tan"))},Qs=e=>`sign(${e}) * (1 - exp(-2 * abs(${e}))) / (1 + exp(-2 * abs(${e})))`,xm=e=>{e.compute(Ke(e.inputs[0],"Tanh",Qs))},Fo=(e="f32")=>`
const fast_gelu_a: ${e} = 0.5;
const fast_gelu_b: ${e} = 0.7978845608028654;
const fast_gelu_c: ${e} = 0.035677408136300125;

fn tanh_v(v: vec4<${e}>) -> vec4<${e}> {
  return ${Qs("v")};
}
`,Uo=e=>`(fast_gelu_a + fast_gelu_a * tanh_v(${e} * (fast_gelu_c * ${e} * ${e} + fast_gelu_b))) * ${e}`,$m=e=>{let t=ft(e.inputs[0].dataType);e.compute(Ke(e.inputs[0],"FastGelu",Uo,Fo(t),void 0,e.inputs[0].dataType))},Cm=(e,t)=>{let r=ft(e.inputs[0].dataType);return e.compute(Ke(e.inputs[0],"ThresholdedRelu",n=>`select(vec4<${r}>(0.0), ${n}, ${n} > thresholded_relu_alpha_)`,`const thresholded_relu_alpha_ = vec4<${r}>(${t.alpha});`,t.cacheKey)),0},Im=e=>{e.compute(Ke(e.inputs[0],"Log","log"))},ap=(e,t)=>`
const alpha = vec4<${e}>(${t});
const one = ${e}(1.0);
const zero = ${e}(0.0);

fn quick_gelu_impl(x: vec4<${e}>) -> vec4<${e}> {
  let v = x *alpha;
  var x1 : vec4<${e}>;
  for (var i = 0; i < 4; i = i + 1) {
    if (v[i] >= zero) {
      x1[i] = one / (one + exp(-v[i]));
    } else {
      x1[i] = one - one / (one + exp(v[i]));
    }
  }
  return x * x1;
}
`,lp=e=>`quick_gelu_impl(${e})`,Tm=(e,t)=>{let r=ft(e.inputs[0].dataType);e.compute(Ke(e.inputs[0],"QuickGelu",lp,ap(r,t.alpha),t.cacheKey,e.inputs[0].dataType))}}),fv=de(()=>{"use strict";Me(),Re(),pa(),up=e=>{if(e[0].dims.length!==3)throw new Error("input should have 3 dimensions");if(![2560,5120,10240].includes(e[0].dims[2]))throw new Error("hidden state should be 2560, 5120 or 10240");if(e[1].dims.length!==1)throw new Error("bias is expected to have 1 dimensions");if(e[0].dims[2]!==e[1].dims[0])throw new Error("last dimension of input and bias are not the same")},dp=e=>{let t=e[0].dims.slice();t[2]=t[2]/2;let r=Z("input",e[0].dataType,e[0].dims,4),n=Z("bias",e[0].dataType,[e[0].dims[2]],4),s=we("output",e[0].dataType,t,4),l=V.size(t)/4,a=ht(e[0].dataType);return{name:"BiasSplitGelu",getRunData:()=>({outputs:[{dims:t,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(l/64)}}),getShaderSource:d=>`
  const M_SQRT2 = sqrt(2.0);
  const halfChannels = ${e[0].dims[2]/4/2}u;

  ${d.declareVariables(r,n,s)}

  ${In(a)}

  ${d.mainStart()}
    ${d.guardAgainstOutOfBoundsWorkgroupSizes(l)}
    let biasIdx = global_idx % halfChannels;
    let batchIndex = global_idx / halfChannels;
    let inputOffset = biasIdx + batchIndex * halfChannels * 2;
    let valueLeft = input[inputOffset] + bias[biasIdx];
    let valueRight = input[inputOffset + halfChannels] + bias[biasIdx + halfChannels];
    let geluRight = valueRight * 0.5 * (erf_vf32(valueRight / M_SQRT2) + 1);

    ${s.setByOffset("global_idx","valueLeft * geluRight")}
  }`}},Sm=e=>{up(e.inputs),e.compute(dp(e.inputs))}}),hv=de(()=>{"use strict";Oe(),Me(),Re(),pp=(e,t,r,n,s,l,a,d,p,c,g,_)=>{let w,C;typeof d=="string"?w=C=(T,B)=>`${d}((${T}),(${B}))`:typeof d=="function"?w=C=d:(w=d.scalar,C=d.vector);let x=we("outputData",g,n.length,4),S=Z("aData",p,t.length,4),N=Z("bData",c,r.length,4),E;if(s)if(l){let T=V.size(t)===1,B=V.size(r)===1,L=t.length>0&&t[t.length-1]%4===0,M=r.length>0&&r[r.length-1]%4===0;T||B?E=x.setByOffset("global_idx",C(T?`${S.type.value}(${S.getByOffset("0")}.x)`:S.getByOffset("global_idx"),B?`${N.type.value}(${N.getByOffset("0")}.x)`:N.getByOffset("global_idx"))):E=`
            let outputIndices = ${x.offsetToIndices("global_idx * 4u")};
            let offsetA = ${S.broadcastedIndicesToOffset("outputIndices",x)};
            let offsetB = ${N.broadcastedIndicesToOffset("outputIndices",x)};
            ${x.setByOffset("global_idx",C(a||L?S.getByOffset("offsetA / 4u"):`${S.type.value}(${S.getByOffset("offsetA / 4u")}[offsetA % 4u])`,a||M?N.getByOffset("offsetB / 4u"):`${N.type.value}(${N.getByOffset("offsetB / 4u")}[offsetB % 4u])`))}
          `}else E=x.setByOffset("global_idx",C(S.getByOffset("global_idx"),N.getByOffset("global_idx")));else{if(!l)throw new Error("no necessary to use scalar implementation for element-wise binary op implementation.");let T=(B,L,M="")=>{let F=`aData[indexA${L}][componentA${L}]`,U=`bData[indexB${L}][componentB${L}]`;return`
            let outputIndices${L} = ${x.offsetToIndices(`global_idx * 4u + ${L}u`)};
            let offsetA${L} = ${S.broadcastedIndicesToOffset(`outputIndices${L}`,x)};
            let offsetB${L} = ${N.broadcastedIndicesToOffset(`outputIndices${L}`,x)};
            let indexA${L} = offsetA${L} / 4u;
            let indexB${L} = offsetB${L} / 4u;
            let componentA${L} = offsetA${L} % 4u;
            let componentB${L} = offsetB${L} % 4u;
            ${B}[${L}] = ${M}(${w(F,U)});
          `};g===9?E=`
            var data = vec4<u32>(0);
            ${T("data",0,"u32")}
            ${T("data",1,"u32")}
            ${T("data",2,"u32")}
            ${T("data",3,"u32")}
            outputData[global_idx] = dot(vec4<u32>(0x1, 0x100, 0x10000, 0x1000000), vec4<u32>(data));`:E=`
            ${T("outputData[global_idx]",0)}
            ${T("outputData[global_idx]",1)}
            ${T("outputData[global_idx]",2)}
            ${T("outputData[global_idx]",3)}
          `}return`
        ${e.registerUniform("vec_size","u32").declareVariables(S,N,x)}

        ${_??""}

        ${e.mainStart()}
        ${e.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}
        ${E}
      }`},cp=(e,t,r,n,s,l,a=r.dataType)=>{let d=r.dims.map(Number),p=n.dims.map(Number),c=!V.areEqual(d,p),g=d,_=V.size(d),w=!1,C=!1,x=[c];if(c){let S=ar.calcShape(d,p,!1);if(!S)throw new Error("Can't perform binary op on the given tensors");g=S.slice(),_=V.size(g);let N=V.size(d)===1,E=V.size(p)===1,T=d.length>0&&d[d.length-1]%4===0,B=p.length>0&&p[p.length-1]%4===0;x.push(N),x.push(E),x.push(T),x.push(B);let L=1;for(let M=1;M<g.length;M++){let F=d[d.length-M],U=p[p.length-M];if(F===U)L*=F;else break}L%4===0?(C=!0,w=!0):(N||E||T||B)&&(w=!0)}else w=!0;return x.push(w),{name:e,shaderCache:{hint:t+x.map(S=>S.toString()).join("_"),inputDependencies:["rank","rank"]},getShaderSource:S=>pp(S,d,p,g,w,c,C,s,r.dataType,n.dataType,a,l),getRunData:()=>({outputs:[{dims:g,dataType:a}],dispatchGroup:{x:Math.ceil(_/64/4)},programUniforms:[{type:12,data:Math.ceil(V.size(g)/4)},...Pe(d,p,g)]})}},Zt=(e,t,r,n,s,l)=>{e.compute(cp(t,s??"",e.inputs[0],e.inputs[1],r,n,l))},Pm=e=>{Zt(e,"Add",(t,r)=>`${t}+${r}`)},Em=e=>{Zt(e,"Div",(t,r)=>`${t}/${r}`)},Am=e=>{Zt(e,"Equal",{scalar:(t,r)=>`u32(${t}==${r})`,vector:(t,r)=>`vec4<u32>(${t}==${r})`},void 0,void 0,9)},Om=e=>{Zt(e,"Mul",(t,r)=>`${t}*${r}`)},km=e=>{let t=Z("input",e.inputs[0].dataType,e.inputs[0].dims).type.value;Zt(e,"Pow",{scalar:(r,n)=>`pow_custom(${r},${n})`,vector:(r,n)=>`pow_vector_custom(${r},${n})`},`
    fn pow_custom(a : ${t}, b : ${t}) -> ${t} {
      if (b == ${t}(0.0)) {
        return ${t}(1.0);
      } else if (a < ${t}(0.0) && f32(b) != floor(f32(b))) {
        return ${t}(pow(f32(a), f32(b))); // NaN
      }
      return select(sign(a), ${t}(1.0), round(f32(abs(b) % ${t}(2.0))) != 1.0) * ${t}(${t==="i32"?"round":""}(pow(f32(abs(a)), f32(b))));
    }
    fn pow_vector_custom(a : vec4<${t}>, b : vec4<${t}>) -> vec4<${t}> {
      // TODO: implement vectorized pow
      return vec4<${t}>(pow_custom(a.x, b.x), pow_custom(a.y, b.y), pow_custom(a.z, b.z), pow_custom(a.w, b.w));
    }
      `)},Nm=e=>{Zt(e,"Sub",(t,r)=>`${t}-${r}`)},Bm=e=>{Zt(e,"Greater",{scalar:(t,r)=>`u32(${t}>${r})`,vector:(t,r)=>`vec4<u32>(${t}>${r})`},void 0,void 0,9)},Lm=e=>{Zt(e,"Less",{scalar:(t,r)=>`u32(${t}<${r})`,vector:(t,r)=>`vec4<u32>(${t}<${r})`},void 0,void 0,9)},Mm=e=>{Zt(e,"GreaterOrEqual",{scalar:(t,r)=>`u32(${t}>=${r})`,vector:(t,r)=>`vec4<u32>(${t}>=${r})`},void 0,void 0,9)},Rm=e=>{Zt(e,"LessOrEqual",{scalar:(t,r)=>`u32(${t}<=${r})`,vector:(t,r)=>`vec4<u32>(${t}<=${r})`},void 0,void 0,9)}}),mv=de(()=>{"use strict";Oe(),Me(),dt(),Re(),fp=(e,t)=>{if(!e||e.length<1)throw new Error("too few inputs");let r=0,n=e[r],s=n.dataType,l=n.dims.length;e.forEach((a,d)=>{if(d!==r){if(a.dataType!==s)throw new Error("input tensors should be one type");if(a.dims.length!==l)throw new Error("input tensors should have the same shape");a.dims.forEach((p,c)=>{if(c!==t&&p!==n.dims[c])throw new Error("non concat dimensions must match")})}})},hp=(e,t)=>`
  fn calculateInputIndex(index: u32) -> u32 {
    let sizeInConcatAxis = array<u32, ${e}u>(${t});
    for (var i: u32 = 0u; i < ${e}; i += 1u ) {
      if (index < sizeInConcatAxis[i]) {
        return i;
      }
    }
    return ${e}u;
  }`,mp=(e,t)=>{let r=e.length,n=[];for(let s=0;s<r;++s){let l=t.setByOffset("global_idx",e[s].getByIndices("indices"));r===1?n.push(l):s===0?n.push(`if (inputIndex == ${s}u) { ${l} }`):s===r-1?n.push(`else { ${l} }`):n.push(`else if (inputIndex == ${s}) { ${l} }`)}return n.join(`
`)},gp=(e,t,r,n)=>{let s=V.size(r),l=new Array(e.length),a=new Array(e.length),d=0,p=[],c=[],g=[{type:12,data:s}];for(let S=0;S<e.length;++S)d+=e[S].dims[t],l[S]=d,c.push(e[S].dims.length),a[S]=Z(`input${S}`,n,c[S]),p.push("rank"),g.push({type:12,data:l[S]});for(let S=0;S<e.length;++S)g.push(...Pe(e[S].dims));g.push(...Pe(r));let _=we("output",n,r.length),w=_.indicesGet("indices",t),C=Array.from(Array(l.length).keys()).map(S=>`uniforms.sizeInConcatAxis${S}`).join(","),x=S=>`

  ${(()=>{S.registerUniform("outputSize","u32");for(let N=0;N<e.length;N++)S.registerUniform(`sizeInConcatAxis${N}`,"u32");return S.declareVariables(...a,_)})()}

  ${hp(l.length,C)}

  ${S.mainStart()}
    ${S.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}

    var indices = ${_.offsetToIndices("global_idx")};

    let inputIndex = calculateInputIndex(${w});
    if (inputIndex != 0u) {
      let sizeInConcatAxis = array<u32, ${l.length}u>(${C});
      ${w} -= sizeInConcatAxis[inputIndex - 1u];
    }

    ${mp(a,_)}
  }`;return{name:"Concat",shaderCache:{hint:`${t}`,inputDependencies:p},getRunData:()=>({outputs:[{dims:r,dataType:n}],dispatchGroup:{x:Math.ceil(s/64)},programUniforms:g}),getShaderSource:x}},Dm=(e,t)=>{let r=e.inputs,n=r[0].dims,s=V.normalizeAxis(t.axis,n.length);fp(r,s);let l=n.slice();l[s]=r.reduce((d,p)=>d+(p.dims.length>s?p.dims[s]:0),0);let a=r.filter(d=>V.size(d.dims)>0);e.compute(gp(a,s,l,r[0].dataType),{inputs:a})},zm=e=>Ze({axis:e.axis})}),tr=de(()=>{"use strict";Oe(),Me(),Zi=(e,t,r="f32")=>{switch(e.activation){case"Relu":return`value = max(value, ${t}(0.0));`;case"Sigmoid":return`value = (${t}(1.0) / (${t}(1.0) + exp(-value)));`;case"Clip":return`value = clamp(value, ${t}(${r}(uniforms.clip_min)), ${t}(${r}(uniforms.clip_max)));`;case"HardSigmoid":return`value = max(${t}(0.0), min(${t}(1.0), ${r}(uniforms.alpha) * value + ${r}(uniforms.beta)));`;case"LeakyRelu":return`value = select(${r}(uniforms.alpha) * value, value, value >= ${t}(0.0));`;case"Tanh":return`let e2x = exp(-2.0 * abs(value));
              value = sign(value) * (1.0 - e2x) / (1.0 + e2x);
        `;case"":return"";default:throw new Error(`Unsupported activation ${e.activation}`)}},Ji=(e,t)=>{e.activation==="Clip"?t.push({type:1,data:e.clipMax},{type:1,data:e.clipMin}):e.activation==="HardSigmoid"?t.push({type:1,data:e.alpha},{type:1,data:e.beta}):e.activation==="LeakyRelu"&&t.push({type:1,data:e.alpha})},Qi=(e,t)=>{e.activation==="Clip"?t.push({name:"clip_max",type:"f32"},{name:"clip_min",type:"f32"}):e.activation==="HardSigmoid"?t.push({name:"alpha",type:"f32"},{name:"beta",type:"f32"}):e.activation==="LeakyRelu"&&t.push({name:"alpha",type:"f32"})},ca=e=>{let t=e?.activation||"";if(t==="HardSigmoid"){let[r,n]=e?.activation_params||[.2,.5];return{activation:t,alpha:r,beta:n}}else if(t==="Clip"){let[r,n]=e?.activation_params||[dh,ph];return{activation:t,clipMax:n,clipMin:r}}else if(t==="LeakyRelu"){let[r]=e?.activation_params||[.01];return{activation:t,alpha:r}}return{activation:t}}}),fa=de(()=>{"use strict";gt=(e,t)=>{switch(e){case 1:return t;case 2:return`vec2<${t}>`;case 3:return`vec3<${t}>`;case 4:return`vec4<${t}>`;default:throw new Error(`${e}-component is not supported.`)}},Fm=e=>`
      ${e?"value = value + getBiasByOutputCoords(coords);":""}
      `}),gv=de(()=>{"use strict";Um=e=>`
fn getIndexFromCoords4D(coords : vec4<i32>, shape : vec4<i32>) -> i32 {
  return dot(coords, vec4<i32>(
      shape.y * shape.z * shape.w, shape.z * shape.w, shape.w, 1));
}
fn getOutputIndexFromCoords(coords : vec4<i32>) -> i32 {
  return dot(coords, vec4<i32>(
    i32(${e}.x), i32(${e}.y), i32(${e}.z), 1));
}
`}),ma=de(()=>{"use strict";Oe(),Me(),Re(),tr(),Nr=(e,t,r,n,s)=>{let l=n-r;return`
      ${Array.from({length:r}).map((a,d)=>`
      if (${Ce(t.shape,d,t.rank)} != 1) {
        ${t.indicesSet(e,d,Ce(s,d+l,n))}
      } else {
        ${t.indicesSet(e,d,0)}
      }`).join("")}
`},ha=(e,t,r,n,s=!1,l)=>{let a=e[0].dims,d=e[1].dims,p=a[a.length-2],c=d[d.length-1],g=a[a.length-1],_=ut(c),w=ut(g),C=ut(p),x=V.size(r)/_/C,S=e.length>2,N=n?n.slice(0,-2):r.slice(0,-2),E=[V.size(N),p,c],T=[{type:12,data:x},{type:12,data:p},{type:12,data:c},{type:12,data:g}];Ji(t,T),T.push(...Pe(N,a,d)),S&&T.push(...Pe(e[2].dims)),T.push(...Pe(E));let B=L=>{let M=la("batch_dims",e[0].dataType,N.length),F=Z("a",e[0].dataType,a.length,w),U=Z("b",e[1].dataType,d.length,_),k=we("output",e[0].dataType,E.length,_),re=ht(k.type.tensor),oe=Zi(t,k.type.value,re),ye=[F,U],fe="";if(S){let q=s?_:1;ye.push(Z("bias",e[2].dataType,e[2].dims.length,q)),fe=`${s?`value += bias[col / ${q}];`:`value += ${k.type.value}(bias[row + i]);`}`}let ce=[{name:"output_size",type:"u32"},{name:"M",type:"u32"},{name:"N",type:"u32"},{name:"K",type:"u32"}];Qi(t,ce);let $e=()=>{let q=`var a_data: ${F.type.value};`;for(let Y=0;Y<w;Y++)q+=`
              let b_data${Y} = b[(b_offset + (k + ${Y}) * uniforms.N + col) / ${_}];`;for(let Y=0;Y<C;Y++){q+=`a_data = a[(a_offset + (row + ${Y}) * uniforms.K + k) / ${w}];`;for(let Ie=0;Ie<w;Ie++)q+=`
            values[${Y}] = fma(${U.type.value}(a_data${w===1?"":`[${Ie}]`}), b_data${Ie}, values[${Y}]);
`}return q};return`
  ${L.registerUniforms(ce).registerInternalVariables(M).declareVariables(...ye,k)}
  ${L.mainStart()}
    ${L.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let col = (global_idx % (uniforms.N / ${_})) * ${_};
    var index1 = global_idx / (uniforms.N / ${_});
    let stride1 = uniforms.M / ${C};
    let row = (index1 % stride1) * ${C};
    let batch = index1 / stride1;

    ${r.length===2?"":`let batch_indices = ${M.offsetToIndices("batch")};`}

    var a_indices: ${F.type.indices};
    ${Nr("a_indices",F,F.rank-2,M.rank,"batch_indices")}
    ${F.indicesSet("a_indices",F.rank-2,0)}
    ${F.indicesSet("a_indices",F.rank-1,0)}
    let a_offset = ${F.indicesToOffset("a_indices")};

    var b_indices: ${U.type.indices};
    ${Nr("b_indices",U,U.rank-2,M.rank,"batch_indices")}
    ${U.indicesSet("b_indices",U.rank-2,0)}
    ${U.indicesSet("b_indices",U.rank-1,0)}
    let b_offset = ${U.indicesToOffset("b_indices")};
    var values: array<${k.type.value}, ${C}>;
    for (var k: u32 = 0u; k < uniforms.K; k = k + ${w}) {
      ${$e()}
    }
    for (var i = 0u; i < ${C}u; i++) {
      var value = values[i];
      ${fe}
      ${oe}
      let cur_indices = ${k.type.indices}(batch, row + i, col);
      let offset = ${k.indicesToOffset("cur_indices")};
      ${k.setByOffset(`offset / ${_}`,"value")};
    }
  }
  `};return{name:"MatMulNaive",shaderCache:{hint:`${t.activation};${_};${w};${C};${s}`,inputDependencies:S?["rank","rank","rank"]:["rank","rank"]},getRunData:()=>({outputs:[{dims:l?l(r):r,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(x/64)},programUniforms:T}),getShaderSource:B}}}),ga=de(()=>{"use strict";Oe(),Me(),Re(),tr(),ma(),fa(),yp=(e,t)=>e?`
        mm_Asub[inputRow][inputCol] = mm_readA(batch,
          kStart + inputRow,
          globalRowStart / innerElementSize + inputCol${t?", batchIndices":""});
        `:`
        mm_Asub[inputRow][inputCol] = mm_readA(batch,
          globalRow + innerRow,
          kStart / innerElementSize + inputCol${t?", batchIndices":""});
        `,_p=(e,t)=>e?`
        let ACached0 = mm_Asub[k * innerElementSize][localRow];
        let ACached1 = mm_Asub[k * innerElementSize + 1][localRow];
        let ACached2 = mm_Asub[k * innerElementSize + 2][localRow];
        ${t===3?"":"let ACached3 = mm_Asub[k * innerElementSize + 3][localRow];"}
        for (var i = 0; i < rowPerThread; i = i + 1) {
          acc[i] = BCached0 * ACached0[i] + acc[i];
          acc[i] = BCached1 * ACached1[i] + acc[i];
          acc[i] = BCached2 * ACached2[i] + acc[i];
          ${t===3?"":"acc[i] = BCached3 * ACached3[i] + acc[i];"}
        }`:`
        for (var i = 0; i < rowPerThread; i = i + 1) {
          let ACached = mm_Asub[tileRow + i][k];
          acc[i] = BCached0 * ACached.x + acc[i];
          acc[i] = BCached1 * ACached.y + acc[i];
          acc[i] = BCached2 * ACached.z + acc[i];
          ${t===3?"":"acc[i] = BCached3 * ACached.w + acc[i];"}
        }`,qo=(e,t,r="f32",n,s=!1,l=32,a=!1,d=32)=>{let p=t[1]*e[1],c=t[0]*e[0],g=s?p:l,_=s?l:p,w=g/t[0],C=l/t[1];if(!((s&&w===4&&e[1]===4||!s&&(w===3||w===4))&&g%t[0]===0&&l%t[1]===0&&e[0]===4))throw new Error(`If transposeA ${s} is true, innerElementSize ${w} and workPerThread[1] ${e[1]} must be 4.
      Otherwise, innerElementSize ${w} must be 3 or 4.
  tileAWidth ${g} must be divisible by workgroupSize[0]${t[0]}. tileInner ${l} must be divisible by workgroupSize[1] ${t[1]}. colPerThread ${e[0]} must be 4.`);return`
var<workgroup> mm_Asub: array<array<vec${w}<${r}>, ${g/w}>, ${_}>;
var<workgroup> mm_Bsub: array<array<vec4<${r}>, ${c/e[0]}>, ${l}>;

const rowPerThread = ${e[1]};
const colPerThread = ${e[0]};
const innerElementSize = ${w};
const tileInner = ${l};

@compute @workgroup_size(${t[0]}, ${t[1]}, ${t[2]})
fn main(@builtin(local_invocation_id) localId : vec3<u32>,
        @builtin(global_invocation_id) globalId : vec3<u32>,
        @builtin(workgroup_id) workgroupId : vec3<u32>) {
  let localRow = i32(localId.y);
  let tileRow = localRow * rowPerThread;
  let tileCol = i32(localId.x);

  let globalRow =i32(globalId.y) * rowPerThread;
  let globalCol = i32(globalId.x);
  let batch = ${a?"0":"i32(globalId.z)"};
  ${n?`let batchIndices = ${n.offsetToIndices("u32(batch)")};`:""}
  let globalRowStart = i32(workgroupId.y) * ${p};

  let num_tiles = ${a?`${Math.ceil(d/l)}`:"(uniforms.dim_inner - 1) / tileInner + 1"};
  var kStart = ${a?`i32(globalId.z) * ${d}`:"0"};

  var acc: array<vec4<${r}>, rowPerThread>;

  // Loop over shared dimension.
  let tileRowB = localRow * ${C};
  for (var t = 0; t < num_tiles; t = t + 1) {
      // Load one tile of A into local memory.
      for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
          let inputRow = tileRow + innerRow;
          let inputCol = tileCol;
          ${yp(s,n)}
      }

      // Load one tile of B into local memory.
      for (var innerRow = 0; innerRow < ${C}; innerRow = innerRow + 1) {
          let inputRow = tileRowB + innerRow;
          let inputCol = tileCol;
          mm_Bsub[inputRow][inputCol] = mm_readB(batch, kStart + inputRow, globalCol${n?", batchIndices":""});
      }
      kStart = kStart + tileInner;
      workgroupBarrier();

      // Compute acc values for a single thread.
      for (var k = 0; k < tileInner / innerElementSize; k = k + 1) {
          let BCached0 = mm_Bsub[k * innerElementSize][tileCol];
          let BCached1 = mm_Bsub[k * innerElementSize + 1][tileCol];
          let BCached2 = mm_Bsub[k * innerElementSize + 2][tileCol];
          ${w===3?"":"let BCached3 = mm_Bsub[k * innerElementSize + 3][tileCol];"}

          ${_p(s,w)}
      }

      workgroupBarrier();
  }

  for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
      mm_write(batch, globalRow + innerRow, globalCol, acc[innerRow]);
  }
}`},eo=(e,t)=>e?`
            mm_Asub[inputRow][inputCol] = mm_readA(batch,
              kStart + inputRow,
              globalRowStart + inputCol${t?", batchIndices":""});
            `:`
            mm_Asub[inputRow][inputCol] = mm_readA(batch,
              globalRowStart + inputRow,
              kStart + inputCol${t?", batchIndices":""});
            `,vp=e=>e?"let ACached = mm_Asub[k][tileRow + innerRow];":"let ACached = mm_Asub[tileRow + innerRow][k];",Wo=(e,t,r="f32",n,s=!1,l=32,a=!1,d=32,p=!1)=>{let c=e[1]*t[1],g=e[0]*t[0],_=s?c:l,w=s?l:c;if(!(w%t[1]===0&&_%t[0]===0&&l%t[1]===0))throw new Error(`tileAHight ${w} must be divisible by workgroupSize[1]${t[1]}, tileAWidth ${_} must be divisible by workgroupSize[0]${t[0]}, tileInner ${l} must be divisible by workgroupSize[1]${t[1]}`);let C=w/t[1],x=_/t[0],S=l/t[1],N=p?`
    let localRow = i32(localId.y);
    let localCol = i32(localId.x);
    let globalRowStart = i32(workgroupId.y) * ${c};
    let globalColStart = i32(workgroupId.x) * ${g};

    // Loop over shared dimension.
    for (var t = 0; t < num_tiles; t = t + 1) {
      // Load one tile of A into local memory.
      for (var inputRow = localRow; inputRow < ${w}; inputRow = inputRow + ${t[1]}) {
        for (var inputCol = localCol; inputCol < ${_}; inputCol = inputCol + ${t[0]}) {
          ${eo(s,n)}
        }
      }
      // Load one tile of B into local memory.
      for (var inputRow = localRow; inputRow < ${l}; inputRow = inputRow + ${t[1]}) {
            for (var inputCol = localCol; inputCol < ${g}; inputCol = inputCol + ${t[0]}) {
          mm_Bsub[inputRow][inputCol] = mm_readB(batch,
            kStart + inputRow,
            globalColStart + inputCol${n?", batchIndices":""});
        }
      }
      kStart = kStart + tileInner;
      workgroupBarrier();

      // Compute acc values for a single thread.
      var BCached : array<${r}, colPerThread>;
      for (var k = 0; k < tileInner; k = k + 1) {
        for (var inner = 0; inner < colPerThread; inner = inner + 1) {
          BCached[inner] = mm_Bsub[k][localCol + inner * ${t[0]}];
        }
        for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
          let ACached = ${s?`mm_Asub[k][localRow + innerRow * ${t[1]}];`:`mm_Asub[localRow + innerRow * ${t[1]}][k];`}
          for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
            acc[innerRow][innerCol] = acc[innerRow][innerCol] +
                ACached * BCached[innerCol];
          }
        }
      }
      workgroupBarrier();
    }
    for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
      let gRow = globalRowStart + localRow + innerRow * ${t[1]};
      for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
        let gCol = globalColStart + localCol + innerCol * ${t[0]};
        mm_write(batch, gRow, gCol, acc[innerRow][innerCol]);
      }
    }
    `:`
let tileRow = i32(localId.y) * rowPerThread;
let tileCol = i32(localId.x) * colPerThread;

let globalRow = i32(globalId.y) * rowPerThread;
let globalCol = i32(globalId.x) * colPerThread;
let globalRowStart = i32(workgroupId.y) * ${c};

let tileRowA = i32(localId.y) * ${C};
let tileColA = i32(localId.x) * ${x};
let tileRowB = i32(localId.y) * ${S};
// Loop over shared dimension.
for (var t = 0; t < num_tiles; t = t + 1) {
  // Load one tile of A into local memory.
  for (var innerRow = 0; innerRow < ${C}; innerRow = innerRow + 1) {
    for (var innerCol = 0; innerCol < ${x}; innerCol = innerCol + 1) {
      let inputRow = tileRowA + innerRow;
      let inputCol = tileColA + innerCol;
      ${eo(s,n)}
    }
  }

  // Load one tile of B into local memory.
  for (var innerRow = 0; innerRow < ${S}; innerRow = innerRow + 1) {
    for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
      let inputRow = tileRowB + innerRow;
      let inputCol = tileCol + innerCol;
      mm_Bsub[inputRow][inputCol] = mm_readB(batch,
        kStart + inputRow,
        globalCol + innerCol${n?", batchIndices":""});
    }
  }
  kStart = kStart + tileInner;
  workgroupBarrier();

  // Compute acc values for a single thread.
  var BCached : array<${r}, colPerThread>;
  for (var k = 0; k < tileInner; k = k + 1) {
    for (var inner = 0; inner < colPerThread; inner = inner + 1) {
      BCached[inner] = mm_Bsub[k][tileCol + inner];
    }

    for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
      ${vp(s)}
      for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
        acc[innerRow][innerCol] = acc[innerRow][innerCol] + ACached * BCached[innerCol];
      }
    }
  }

  workgroupBarrier();
}

for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
  for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
    mm_write(batch, globalRow + innerRow, globalCol + innerCol,
        acc[innerRow][innerCol]);
  }
}
`;return`
  var<workgroup> mm_Asub : array<array<${r}, ${_}>, ${w}>;
  var<workgroup> mm_Bsub : array<array<${r}, ${g}>, ${l}>;
  const rowPerThread = ${e[1]};
  const colPerThread = ${e[0]};
  const tileInner = ${l};

@compute @workgroup_size(${t[0]}, ${t[1]}, ${t[2]})
fn main(@builtin(local_invocation_id) localId : vec3<u32>,
        @builtin(global_invocation_id) globalId : vec3<u32>,
        @builtin(workgroup_id) workgroupId : vec3<u32>) {
    let batch = ${a?"0":"i32(globalId.z)"};
    ${n?`let batchIndices = ${n.offsetToIndices("u32(batch)")};`:""}
    let num_tiles = ${a?`${Math.ceil(d/l)}`:"(uniforms.dim_inner - 1) / tileInner + 1"};
    var kStart = ${a?`i32(globalId.z) * ${d}`:"0"};

    var acc : array<array<${r}, colPerThread>, rowPerThread>;
    ${N}
  }
`},wp=(e,t,r,n,s=!1)=>{let[l,a,d,p]=n,c=ht(n[0].type.tensor);return`
    fn mm_readA(batch: i32, row: i32, colIn: i32, batchIndices: ${l.type.indices}) -> ${gt(e,c)} {
      var value = ${gt(e,c)}(0.0);
      let col = colIn * ${e};
      if(row < uniforms.dim_a_outer && col < uniforms.dim_inner)
      {
        var aIndices: ${a.type.indices};
        ${Nr("aIndices",a,a.rank-2,l.rank,"batchIndices")}
        ${a.indicesSet("aIndices",a.rank-2,"u32(row)")}
        ${a.indicesSet("aIndices",a.rank-1,"u32(colIn)")}
        value = ${a.getByIndices("aIndices")};
      }
      return value;
    }

    fn mm_readB(batch: i32, row: i32, colIn: i32, batchIndices: ${l.type.indices}) -> ${gt(e,c)} {
      var value = ${gt(e,c)}(0.0);
      let col = colIn * ${e};
      if(row < uniforms.dim_inner && col < uniforms.dim_b_outer)
      {
        var bIndices: ${d.type.indices};
        ${Nr("bIndices",d,d.rank-2,l.rank,"batchIndices")}
        ${d.indicesSet("bIndices",d.rank-2,"u32(row)")}
        ${d.indicesSet("bIndices",d.rank-1,"u32(colIn)")}
        value = ${d.getByIndices("bIndices")};
      }
      return value;
    }

    fn mm_write(batch: i32, row: i32, colIn: i32, valueIn: ${gt(e,c)}) {
      let col = colIn * ${e};
      if (row < uniforms.dim_a_outer && col < uniforms.dim_b_outer) {
        var value = valueIn;
        let coords = vec3<i32>(batch, row, colIn);
        ${t?`value = value + ${s?"bias[colIn]":`${gt(e,c)}(bias[row])`};`:""}
        ${r}
        ${p.setByIndices("vec3<u32>(coords)","value")}
      }
    }
    `},An=(e,t,r,n,s=!1,l)=>{let a=e[0].dims,d=e[1].dims,p=a.slice(0,-2),c=d.slice(0,-2),g=n?n.slice(0,-2):r.slice(0,-2),_=V.size(g),w=a[a.length-2],C=a[a.length-1],x=d[d.length-1],S=C%4===0&&x%4===0,N=w<=8?[4,1,1]:[4,4,1],E=[8,8,1],T=[Math.ceil(x/E[0]/N[0]),Math.ceil(w/E[1]/N[1]),Math.ceil(_/E[2]/N[2])],B=S?4:1,L=[...p,w,C/B],M=L.length,F=[...c,C,x/B],U=F.length,k=[_,w,x/B],re=[{type:6,data:w},{type:6,data:x},{type:6,data:C}];Ji(t,re),re.push(...Pe(g,L,F));let oe=["rank","rank"],ye=e.length>2;ye&&(re.push(...Pe(e[2].dims)),oe.push("rank")),re.push(...Pe(k));let fe=ce=>{let $e=g.length,q=la("batchDims",e[0].dataType,$e,1),Y=ht(e[0].dataType),Ie=Z("a",e[0].dataType,M,B),Te=Z("b",e[1].dataType,U,B),be=we("result",e[0].dataType,k.length,B),ke=[Ie,Te];if(ye){let Ue=s?B:1;ke.push(Z("bias",e[2].dataType,e[2].dims.length,Ue))}let ne=[{name:"dim_a_outer",type:"i32"},{name:"dim_b_outer",type:"i32"},{name:"dim_inner",type:"i32"}];Qi(t,ne);let Se=ht(be.type.tensor),ve=Zi(t,be.type.value,Se),me=wp(B,ye,ve,[q,Ie,Te,be],s);return`
  ${ce.registerUniforms(ne).registerInternalVariables(q).declareVariables(...ke,be)}
  ${me}
  ${S?qo(N,E,Y,q):Wo(N,E,Y,q)}
                   `};return{name:"MatMul",shaderCache:{hint:`${N};${t.activation};${S};${s}`,inputDependencies:oe},getRunData:()=>({outputs:[{dims:l?l(r):r,dataType:e[0].dataType}],dispatchGroup:{x:T[0],y:T[1],z:T[2]},programUniforms:re}),getShaderSource:fe}}}),yv=de(()=>{"use strict";Oe(),wi(),Re(),tr(),fa(),gv(),ga(),bp=(e,t,r,n,s=!1,l,a=4,d=4,p=4,c="f32")=>{let g=re=>{switch(re){case 1:return"resData = x[xIndex];";case 3:return`resData = vec3<${c}>(x[xIndex], x[xIndex + 1], x[xIndex + 2]);`;case 4:return"resData = x[xIndex / 4];";default:throw new Error(`innerElementSize ${re} is not supported.`)}},_=re=>{switch(re){case 1:return"return w[row * i32(uniforms.w_shape[3]) + colIn];";case 4:return"return w[row * i32(uniforms.w_shape[3]) / 4 + colIn];";default:throw new Error(`innerElementSize ${re} is not supported.`)}},w=e?`
    let coord = vec4<i32>(batch, xRow, xCol, xCh);
    `:`
    let coord = vec4<i32>(batch, xCh, xRow, xCol);
    `,C=e?`
    let coords = vec4<i32>(
      batch,
      row / outWidth,
      row % outWidth,
      col);
    `:`
    let coords = vec4<i32>(
      batch,
      row,
      col / outWidth,
      col % outWidth);
    `,x=e?"i32(uniforms.x_shape[1])":"i32(uniforms.x_shape[2])",S=e?"i32(uniforms.x_shape[2])":"i32(uniforms.x_shape[3])",N=e?"row":"col",E=e?"col":"row",T=`
    let inChannels = i32(uniforms.w_shape[2]);
    let outWidth = ${e?"i32(uniforms.result_shape[2])":"i32(uniforms.result_shape[3])"};
    let outRow = ${N} / outWidth;
    let outCol = ${N} % outWidth;

    let WRow = ${E} / (i32(uniforms.w_shape[1]) * inChannels);
    let WCol = ${E} / inChannels % i32(uniforms.w_shape[1]);
    let xRow = outRow * uniforms.stride[0] + uniforms.dilation[0] * WRow - uniforms.pad[0];
    let xCol = outCol * uniforms.stride[1] + uniforms.dilation[1] * WCol - uniforms.pad[1];
    let xCh = ${E} % inChannels;
    var resData = ${gt(a,c)}(0.0);
    // The bounds checking is always needed since we use it to pad zero for
    // the 'same' padding type.
    if (xRow >= 0 && xRow < ${x} && xCol >= 0 && xCol < ${S}) {
      ${w}
      let xIndex = getIndexFromCoords4D(coord, vec4<i32>(uniforms.x_shape));
      ${g(a)}
    }
    return resData;`,B=e?t&&n?`
    let col = colIn * ${a};
    ${T}`:`
    let col = colIn * ${a};
    if (row < uniforms.dim_a_outer && col < uniforms.dim_inner) {
      ${T}
    }
    return ${gt(a,c)}(0.0);`:n&&r?`
    let col = colIn * ${a};
    ${T}`:`
    let col = colIn * ${a};
    if (row < uniforms.dim_inner && col < uniforms.dim_b_outer) {
      ${T}
    }
    return ${gt(a,c)}(0.0);`,L=e?n&&r?_(d):`
    let col = colIn * ${d};
    if (row < uniforms.dim_inner && col < uniforms.dim_b_outer) {
      ${_(d)}
    }
    return ${gt(d,c)}(0.0);`:`
    let col = colIn * ${d};
    if (row < uniforms.dim_inner && col < uniforms.dim_a_outer) {
      ${_(d)}
    }
    return ${gt(d,c)}(0.0);`,M=gt(p,c),F=gt(e?a:d,c),U=gt(e?d:a,c),k=Zi(l,M,c);return`
    fn mm_readA(batch: i32, row : i32, colIn : i32) -> ${F} {
      ${e?B:L}
    }

    fn mm_readB(batch: i32, row : i32, colIn : i32) -> ${U} {
      ${e?L:B}
    }

    fn mm_write(batch: i32, row : i32, colIn : i32, valueIn : ${M}) {
      let col = colIn * ${p};
      if (row < uniforms.dim_a_outer && col < uniforms.dim_b_outer)
      {
      var value = valueIn;
      let outWidth = ${e?"i32(uniforms.result_shape[2])":"i32(uniforms.result_shape[3])"};
      ${C}
      ${Fm(s)}
      ${k}
      setOutputAtCoords(coords[0], coords[1], coords[2], coords[3], value);
      }
    }`},qm=(e,t,r,n,s,l,a,d,p)=>{let c=t.format==="NHWC",g=c?e[0].dims[3]:e[0].dims[1],_=r[0],w=c?r[2]:r[3],C=c?r[1]:r[2],x=c?r[3]:r[1],S=c&&(g%4===0||g%3===0)&&x%4===0,N=c?x:w*C,E=c?w*C:x,T=[8,8,1],B=n<=8?[4,1,1]:[4,4,1],L=[Math.ceil(N/T[0]/B[0]),Math.ceil(E/T[1]/B[1]),Math.ceil(_/T[2]/B[2])];Ve("verbose",()=>`[conv2d_mm_webgpu] dispatch = ${L}`);let M=S?c&&g%4!==0?3:4:1,F=T[1]*B[1],U=T[0]*B[0],k=Math.max(T[0]*M,T[1]),re=n%F===0,oe=s%U===0,ye=l%k===0,fe=S?[M,4,4]:[1,1,1],ce=[{type:6,data:n},{type:6,data:s},{type:6,data:l},{type:6,data:[t.pads[0],t.pads[1]]},{type:6,data:t.strides},{type:6,data:t.dilations}];Ji(t,ce),ce.push(...Pe(e[0].dims,e[1].dims));let $e=["rank","rank"];a&&(ce.push(...Pe(e[2].dims)),$e.push("rank")),ce.push(...Pe(r));let q=Y=>{let Ie=[{name:"dim_a_outer",type:"i32"},{name:"dim_b_outer",type:"i32"},{name:"dim_inner",type:"i32"},{name:"pad",type:"i32",length:2},{name:"stride",type:"i32",length:2},{name:"dilation",type:"i32",length:2}];Qi(t,Ie);let Te=S?4:1,be=ht(e[0].dataType),ke=`
      fn setOutputAtIndex(flatIndex : i32, value : ${S?`vec4<${be}>`:be}) {
        result[flatIndex] = ${S?`vec4<${be}>`:be}(value);
      }
      fn setOutputAtCoords(d0 : i32, d1 : i32, d2 : i32, d3 : i32, value : ${S?`vec4<${be}>`:be}) {
        let flatIndex = getOutputIndexFromCoords(vec4<i32>(d0, d1, d2, d3));
        setOutputAtIndex(flatIndex ${S?"/ 4":""}, value);
      }`,ne=Z("x",e[0].dataType,e[0].dims.length,M===3?1:M),Se=Z("w",e[1].dataType,e[1].dims.length,Te),ve=[ne,Se],me=we("result",e[0].dataType,r.length,Te);if(a){let Ue=Z("bias",e[2].dataType,e[2].dims.length,Te);ve.push(Ue),ke+=`
        fn getBiasByOutputCoords(coords : vec4<i32>) -> ${S?`vec4<${be}>`:be} {
          return bias[coords.${c?"w":"y"}${S?"/ 4":""}];
        }`}return`
        ${Um("uniforms.result_strides")}
        //struct Uniforms { xShape : vec4<i32>, wShape : vec4<i32>, outShape : vec4<i32>,
        //  outShapeStrides: vec3<i32>, filterDims : vec2<i32>, pad : vec2<i32>, stride : vec2<i32>,
        //  dilation : vec2<i32>, dimAOuter : i32, dimBOuter : i32, dimInner : i32 };
        ${Y.registerUniforms(Ie).declareVariables(...ve,me)}
        ${ke}
        ${bp(c,re,oe,ye,a,t,fe[0],fe[1],fe[2],be)}
        ${S?qo(B,T,be,void 0,!c,k):Wo(B,T,be,void 0,!c,k,!1,void 0,d)}`};return{name:"Conv2DMatMul",shaderCache:{hint:`${t.cacheKey};${M};${S};${re};${oe};${ye};${F};${U};${k}`,inputDependencies:$e},getRunData:()=>({outputs:[{dims:p?p(r):r,dataType:e[0].dataType}],dispatchGroup:{x:L[0],y:L[1],z:L[2]},programUniforms:ce}),getShaderSource:q}}}),_v=de(()=>{"use strict";Oe(),wi(),Me(),Re(),tr(),fa(),xp=e=>{let t=1;for(let r=0;r<e.length;r++)t*=e[r];return t},to=e=>typeof e=="number"?[e,e,e]:e,$r=(e,t)=>t<=1?e:e+(e-1)*(t-1),$p=(e,t,r,n=1)=>{let s=$r(t,n);return Math.floor((e[0]*(r-1)-r+s)/2)},io=(e,t,r,n,s)=>{s==null&&(s=$p(e,t[0],n[0]));let l=[0,0,0,r];for(let a=0;a<3;a++)e[a]+2*s>=t[a]&&(l[a]=Math.trunc((e[a]-t[a]+2*s)/n[a]+1));return l},Cp=(e,t,r,n,s,l,a,d,p,c)=>{let g,_,w,C;if(e==="VALID"&&(e=0),typeof e=="number"){g={top:e,bottom:e,left:e,right:e,front:e,back:e};let x=io([t,r,n,1],[d,p,c],1,[s,l,a],e);_=x[0],w=x[1],C=x[2]}else if(Array.isArray(e)){if(!e.every((S,N,E)=>S===E[0]))throw Error(`Unsupported padding parameter: ${e}`);g={top:e[0],bottom:e[1],left:e[2],right:e[3],front:e[4],back:e[5]};let x=io([t,r,n,1],[d,p,c],1,[s,l,a],e[0]);_=x[0],w=x[1],C=x[2]}else if(e==="SAME_UPPER"){_=Math.ceil(t/s),w=Math.ceil(r/l),C=Math.ceil(n/a);let x=(_-1)*s+d-t,S=(w-1)*l+p-r,N=(C-1)*a+c-n,E=Math.floor(x/2),T=x-E,B=Math.floor(S/2),L=S-B,M=Math.floor(N/2),F=N-M;g={top:B,bottom:L,left:M,right:F,front:E,back:T}}else throw Error(`Unknown padding parameter: ${e}`);return{padInfo:g,outDepth:_,outHeight:w,outWidth:C}},Wm=(e,t,r,n,s,l=!1,a="channelsLast")=>{let d,p,c,g,_;if(a==="channelsLast")[d,p,c,g,_]=e;else if(a==="channelsFirst")[d,_,p,c,g]=e;else throw new Error(`Unknown dataFormat ${a}`);let[w,,C,x,S]=t,[N,E,T]=to(r),[B,L,M]=to(n),F=$r(C,B),U=$r(x,L),k=$r(S,M),{padInfo:re,outDepth:oe,outHeight:ye,outWidth:fe}=Cp(s,p,c,g,N,E,T,F,U,k),ce=l?w*_:w,$e=[0,0,0,0,0];return a==="channelsFirst"?$e=[d,ce,oe,ye,fe]:a==="channelsLast"&&($e=[d,oe,ye,fe,ce]),{batchSize:d,dataFormat:a,inDepth:p,inHeight:c,inWidth:g,inChannels:_,outDepth:oe,outHeight:ye,outWidth:fe,outChannels:ce,padInfo:re,strideDepth:N,strideHeight:E,strideWidth:T,filterDepth:C,filterHeight:x,filterWidth:S,effectiveFilterDepth:F,effectiveFilterHeight:U,effectiveFilterWidth:k,dilationDepth:B,dilationHeight:L,dilationWidth:M,inShape:e,outShape:$e,filterShape:t}},Xm=(e,t,r,n,s,l)=>{let a=l==="channelsLast",d=a?e[0].dims[3]:e[0].dims[1],p=!1,c=[64,1,1],g={x:r.map((T,B)=>B)},_=[Math.ceil(xp(g.x.map(T=>r[T]))/c[0]),1,1];Ve("verbose",()=>`[conv3d_naive_webgpu] dispatch = ${_}`);let w=p?a&&d%4!==0?3:4:1,C=V.size(r),x=[{type:12,data:C},{type:12,data:n},{type:12,data:s},{type:12,data:t.strides},{type:12,data:t.dilations}];Ji(t,x),x.push(...Pe(e[0].dims,e[1].dims));let S=["rank","rank"],N=e.length===3;N&&(x.push(...Pe(e[2].dims)),S.push("rank")),x.push(...Pe(r));let E=T=>{let B=[{name:"output_size",type:"u32"},{name:"filter_dims",type:"u32",length:n.length},{name:"pads",type:"u32",length:s.length},{name:"strides",type:"u32",length:t.strides.length},{name:"dilations",type:"u32",length:t.dilations.length}];Qi(t,B);let L=p?4:1,M=ht(e[0].dataType),F=Z("x",e[0].dataType,e[0].dims.length,w===3?1:w),U=Z("W",e[1].dataType,e[1].dims.length,L),k=[F,U],re=we("result",e[0].dataType,r.length,L),oe="";if(N){let ce=Z("bias",e[2].dataType,e[2].dims.length,L);k.push(ce),oe+=`
        fn getBiasByOutputCoords(coords : array<u32, 5>) -> ${p?`vec4<${M}>`:M} {
          return bias[${a?Ce("coords",4,5):Ce("coords",1,5)}${p?"/ 4":""}];
        }`}let ye=gt(w,M),fe=Zi(t,ye,M);return`
            ${oe}
            fn getX(d0 : u32, d1 : u32, d2 : u32, d3 : u32, d4 : u32) -> ${M} {
              let aIndices = array<u32, 5>(d0, d1, d2, d3, d4);
              return ${F.getByIndices("aIndices")};
            }
            fn getW(d0 : u32, d1 : u32, d2 : u32, d3 : u32, d4 : u32) -> ${M} {
              let aIndices = array<u32, 5>(d0, d1, d2, d3, d4);
              return ${U.getByIndices("aIndices")};
            }
          ${T.registerUniforms(B).declareVariables(...k,re)}
          ${T.mainStart()}
          ${T.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
              let coords = ${re.offsetToIndices("global_idx")};
              let batch = ${Ce("coords",0,F.rank)};
              let d2 = ${a?Ce("coords",F.rank-1,F.rank):Ce("coords",1,F.rank)};
              let xFRCCorner = vec3<u32>(${a?Ce("coords",1,F.rank):Ce("coords",2,F.rank)},
              ${a?Ce("coords",2,F.rank):Ce("coords",3,F.rank)},
              ${a?Ce("coords",3,F.rank):Ce("coords",4,F.rank)}) * uniforms.strides - uniforms.pads;
              let xFCorner = xFRCCorner.x;
              let xRCorner = xFRCCorner.y;
              let xCCorner = xFRCCorner.z;
              let xShapeY = ${a?Ce("uniforms.x_shape",1,F.rank):Ce("uniforms.x_shape",2,F.rank)};
              let xShapeZ = ${a?Ce("uniforms.x_shape",2,F.rank):Ce("uniforms.x_shape",3,F.rank)};
              let xShapeW = ${a?Ce("uniforms.x_shape",3,F.rank):Ce("uniforms.x_shape",4,F.rank)};
              let xShapeU = ${a?Ce("uniforms.x_shape",4,F.rank):Ce("uniforms.x_shape",1,F.rank)};
              let inputDepthNearestVec4 = (xShapeU / 4) * 4;
              let inputDepthVec4Remainder = xShapeU % 4;

              var value = ${M}(0);
              for (var wF = 0u; wF < uniforms.filter_dims[0]; wF++) {
                let xF = xFCorner + wF * uniforms.dilations[0];
                if (xF < 0 || xF >= xShapeY) {
                  continue;
                }

                for (var wR = 0u; wR < uniforms.filter_dims[1]; wR++) {
                  let xR = xRCorner + wR * uniforms.dilations[1];
                  if (xR < 0 || xR >= xShapeZ) {
                    continue;
                  }

                  for (var wC = 0u; wC < uniforms.filter_dims[2]; wC++) {
                    let xC = xCCorner + wC * uniforms.dilations[2];
                    if (xC < 0 || xC >= xShapeW) {
                      continue;
                    }

                    for (var d1 = 0u; d1 < inputDepthNearestVec4; d1 += 4) {
                      ${a?`let xValues = vec4<${M}>(
                               getX(batch, xF, xR, xC, d1),
                               getX(batch, xF, xR, xC, d1 + 1),
                               getX(batch, xF, xR, xC, d1 + 2),
                               getX(batch, xF, xR, xC, d1 + 3));
                            `:`let xValues = vec4<${M}>(
                               getX(batch, d1, xF, xR, xC),
                               getX(batch, d1 + 1, xF, xR, xC),
                               getX(batch, d1 + 2, xF, xR, xC),
                               getX(batch, d1 + 3, xF, xR, xC));
                            `}
                            let wValues = vec4<${M}>(
                              getW(d2, d1, wF, wR, wC),
                              getW(d2, d1 + 1, wF, wR, wC),
                              getW(d2, d1 + 2, wF, wR, wC),
                              getW(d2, d1 + 3, wF, wR, wC));
                      value += dot(xValues, wValues);
                    }
                    if (inputDepthVec4Remainder == 1) {
                        ${a?`value += getX(batch, xF, xR, xC, inputDepthNearestVec4)
                          * getW(d2, inputDepthNearestVec4, wF, wR, wC);`:`value += getX(batch, inputDepthNearestVec4, xF, xR, xC)
                          * getW(d2, inputDepthNearestVec4, wF, wR, wC);`}
                    } else if (inputDepthVec4Remainder == 2) {
                      ${a?`let xValues = vec2<${M}>(
                        getX(batch, xF, xR, xC, inputDepthNearestVec4),
                        getX(batch, xF, xR, xC, inputDepthNearestVec4 + 1));
                      `:`let xValues = vec2<${M}>(
                        getX(batch, inputDepthNearestVec4, xF, xR, xC),
                        getX(batch, inputDepthNearestVec4 + 1, xF, xR, xC));
                    `}
                    let wValues = vec2<${M}>(
                      getW(d2, inputDepthNearestVec4, wF, wR, wC),
                      getW(d2, inputDepthNearestVec4 + 1, wF, wR, wC));
                      value += dot(xValues, wValues);
                    } else if (inputDepthVec4Remainder == 3) {
                      ${a?`let xValues = vec3<${M}>(
                        getX(batch, xF, xR, xC, inputDepthNearestVec4),
                        getX(batch, xF, xR, xC, inputDepthNearestVec4 + 1),
                        getX(batch, xF, xR, xC, inputDepthNearestVec4 + 2));
                      `:`let xValues = vec3<${M}>(
                        getX(batch, inputDepthNearestVec4, xF, xR, xC),
                        getX(batch, inputDepthNearestVec4 + 1, xF, xR, xC),
                        getX(batch, inputDepthNearestVec4 + 2, xF, xR, xC));
                    `}
                    let wValues = vec3<${M}>(
                      getW(d2, inputDepthNearestVec4, wF, wR, wC),
                      getW(d2, inputDepthNearestVec4 + 1, wF, wR, wC),
                      getW(d2, inputDepthNearestVec4 + 2, wF, wR, wC));
                      value += dot(xValues, wValues);
                    }
                  }
                }
              }
              ${N?"value = value + getBiasByOutputCoords(coords)":""};
              ${fe}
              result[global_idx] = ${M}(value);
          }`};return{name:"Conv3DNaive",shaderCache:{hint:`${t.cacheKey};${a};${w};${N}`,inputDependencies:S},getRunData:()=>({outputs:[{dims:r,dataType:e[0].dataType}],dispatchGroup:{x:_[0],y:_[1],z:_[2]},programUniforms:x}),getShaderSource:E}}}),vv=de(()=>{"use strict";Oe(),Me(),Re(),tr(),Ym=(e,t,r,n)=>{let s=e.length>2,l=s?"value += b[output_channel];":"",a=e[0].dims,d=e[1].dims,p=t.format==="NHWC",c=p?r[3]:r[1],g=c/t.group,_=p&&g>=4?ut(c):1,w=V.size(r)/_,C=[{type:12,data:w},{type:12,data:t.dilations},{type:12,data:[t.strides[0],t.strides[1]]},{type:12,data:[t.pads[0],t.pads[1]]},{type:12,data:g}];Ji(t,C),C.push(...Pe(a,[d[0],d[1],d[2],d[3]/_]));let x=s?["rank","rank","rank"]:["rank","rank"];C.push(...Pe([r[0],r[1],r[2],r[3]/_]));let S=N=>{let E=we("output",e[0].dataType,r.length,_),T=ht(E.type.tensor),B=Zi(t,E.type.value,T),L=Z("x",e[0].dataType,a.length),M=Z("w",e[1].dataType,d.length,_),F=[L,M];s&&F.push(Z("b",e[2].dataType,e[2].dims,_));let U=[{name:"output_size",type:"u32"},{name:"dilations",type:"u32",length:t.dilations.length},{name:"strides",type:"u32",length:2},{name:"pads",type:"u32",length:2},{name:"output_channels_per_group",type:"u32"}];Qi(t,U);let k=p?`
      for (var wHeight: u32 = 0u; wHeight < uniforms.w_shape[0]; wHeight++) {
        let xHeight = xRCCorner.x + wHeight * uniforms.dilations[0];

        if (xHeight < 0u || xHeight >= uniforms.x_shape[1]) {
          continue;
        }

        for (var wWidth: u32 = 0u; wWidth < uniforms.w_shape[1]; wWidth++) {
          let xWidth = xRCCorner.y + wWidth * uniforms.dilations[1];
          if (xWidth < 0u || xWidth >= uniforms.x_shape[2]) {
            continue;
          }

          for (var wInChannel: u32 = 0u; wInChannel < uniforms.w_shape[2]; wInChannel++) {
            let input_channel = in_channel_offset + wInChannel;
            let xVal = ${L.get("batch","xHeight","xWidth","input_channel")};
            let wVal = ${M.get("wHeight","wWidth","wInChannel","output_channel")};
            value += xVal * wVal;
          }
        }
      }
      `:`
      for (var wInChannel: u32 = 0u; wInChannel < uniforms.w_shape[1]; wInChannel++) {
        let input_channel = in_channel_offset + wInChannel;
        for (var wHeight: u32 = 0u; wHeight < uniforms.w_shape[2]; wHeight++) {
          let xHeight = xRCCorner.x + wHeight * uniforms.dilations[0];

          if (xHeight < 0u || xHeight >= uniforms.x_shape[2]) {
            continue;
          }

          for (var wWidth: u32 = 0u; wWidth < uniforms.w_shape[3]; wWidth++) {
            let xWidth = xRCCorner.y + wWidth * uniforms.dilations[1];
            if (xWidth < 0u || xWidth >= uniforms.x_shape[3]) {
              continue;
            }

            let xVal = ${L.get("batch","input_channel","xHeight","xWidth")};
            let wVal = ${M.get("output_channel","wInChannel","wHeight","wWidth")};
            value += xVal * wVal;
          }
        }
      }
      `;return`
  ${N.registerUniforms(U).declareVariables(...F,E)}

  ${N.mainStart()}
    ${N.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

    let outputIndices = ${E.offsetToIndices("global_idx")};
    let batch: u32 = outputIndices[0];
    let output_channel: u32 = outputIndices[${p?3:1}];
    let xRCCorner: vec2<u32> = vec2<u32>(outputIndices[${p?1:2}], outputIndices[${p?2:3}]) * uniforms.strides - uniforms.pads;
    let group_id: u32 = output_channel * ${_} / uniforms.output_channels_per_group;
    var in_channel_offset = group_id * uniforms.w_shape[${p?2:1}];

    var value: ${E.type.value} = ${E.type.value}(0);
    ${k}
    ${l}
    ${B}
    ${E.setByOffset("global_idx","value")}
  }`};return{name:"GroupedConv",shaderCache:{hint:`${t.cacheKey}_${_}`,inputDependencies:x},getRunData:()=>({outputs:[{dims:n?n(r):r,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(w/64)},programUniforms:C}),getShaderSource:S}},Gm=(e,t,r,n)=>{let s=e.length>2,l=ut(r[3]),a=ut(r[2]),d=V.size(r)/l/a,p=[e[0].dims[0],e[0].dims[1],e[0].dims[2],e[0].dims[3]/l],c=[e[1].dims[0],e[1].dims[1],e[1].dims[2],e[1].dims[3]/l],g=[r[0],r[1],r[2],r[3]/l],_=[{type:12,data:d},{type:6,data:[t.strides[0],t.strides[1]]},{type:6,data:[t.pads[0],t.pads[1]]}];Ji(t,_),_.push(...Pe(p,c,g));let w=(a-1)*t.strides[1]+c[1],C=x=>{let S=we("output",e[0].dataType,g.length,l),N=ht(S.type.tensor),E=Zi(t,S.type.value,N),T=Z("x",e[0].dataType,p.length,l),B=Z("w",e[1].dataType,c.length,l),L=[T,B];s&&L.push(Z("b",e[2].dataType,e[2].dims,l));let M=s?"value += b[output_channel];":"",F=[{name:"output_size",type:"u32"},{name:"strides",type:"i32",length:2},{name:"pads",type:"i32",length:2}];return Qi(t,F),`
  ${x.registerUniforms(F).declareVariables(...L,S)}
  ${x.mainStart()}
    ${x.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let width0 = uniforms.output_shape[3];
    let output_channel = global_idx % width0;
    var index1 = global_idx / width0;
    let width1 = uniforms.output_shape[2] / ${a}u;
    let col = (index1 % width1) * ${a}u;
    index1 = index1 / width1;
    let row = index1 % uniforms.output_shape[1];
    let batch = index1 / uniforms.output_shape[1];

    let x_corner = vec2<i32>(i32(row), i32(col)) * uniforms.strides - uniforms.pads;

    var x_vals: array<${T.type.value}, ${w}>;
    var values: array<${S.type.value}, ${a}>;
    let input_channel = output_channel;
    // Use constant instead of uniform can give better performance for w's height/width.
    for (var w_height: u32 = 0u; w_height < ${c[0]}; w_height++) {
      let x_height = x_corner.x + i32(w_height);
      if (x_height >= 0 && u32(x_height) < uniforms.x_shape[1]) {
        for (var i = 0; i < ${w}; i++) {
          let x_width = x_corner.y + i;
          if (x_width >= 0 && u32(x_width) < uniforms.x_shape[2]) {
            x_vals[i] = ${T.get("batch","u32(x_height)","u32(x_width)","input_channel")};
          } else {
            x_vals[i] = ${T.type.value}(0);
          }
        }
        for (var w_width: u32 = 0u; w_width < ${c[1]}; w_width++) {
          let w_val = ${B.get("w_height","w_width","0","output_channel")};
          for (var i = 0u; i < ${a}u; i++) {
            values[i] = fma(x_vals[i * u32(uniforms.strides[1]) + w_width], w_val, values[i]);
          }
        }
      }
    }

    for (var i = 0u; i < ${a}u; i++) {
      var value = values[i];
      ${M}
      ${E}
      ${S.set("batch","row","col + i","output_channel","value")};
    }
  }`};return{name:"GroupedConv-Vectorize",shaderCache:{hint:`${t.cacheKey};${l};${a};${w};${c[0]};${c[1]}`,inputDependencies:s?["rank","rank","type"]:["rank","rank"]},getRunData:()=>({outputs:[{dims:n?n(r):r,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(d/64)},programUniforms:_}),getShaderSource:C}}}),wv=de(()=>{"use strict";Me(),yv(),_v(),ga(),vv(),tr(),ma(),Li(),Ip=(e,t,r,n,s,l)=>{let a=e[0],d=e.slice(l?1:2,l?3:4),p=d.length,c=t[0],g=t.slice(2).map((w,C)=>w+(w-1)*(r[C]-1)),_=d.map((w,C)=>w+n[C]+n[C+p]).map((w,C)=>Math.floor((w-g[C]+s[C])/s[C]));return _.splice(0,0,a),_.splice(l?3:1,0,c),_},yn=[2,3,1,0],Tp=(e,t)=>{if(!e||e.length!==2&&e.length!==3)throw new Error("Conv requires 2 or 3 inputs");if(e[0].dims.length>5)throw new Error("greater than 5D is not supported");if(e[0].dims.length!==e[1].dims.length)throw new Error("filter does not have same dimension as input");let r=e[0].dims[t.format==="NHWC"?e[0].dims.length-1:1],n=e[1].dims[1]*t.group;if(r!==n)throw new Error("FILTER_IN_CHANNEL should be equal to DATA_CHANNEL");if(e.length===3&&(e[2].dims.length!==1||e[1].dims[0]!==e[2].dims[0]))throw new Error("invalid bias");let s=e[0].dims.length-2;if(t.dilations.length!==s)throw new Error(`dilations should be ${s}D`);if(t.strides.length!==s)throw new Error(`strides should be ${s}D`);if(t.pads.length!==s*2)throw new Error(`pads should be ${s*2}D`);if(t.kernelShape.length!==0&&t.kernelShape.length!==e[1].dims.length-2)throw new Error("invalid kernel shape")},_n=(e,t)=>{let r=e.kernelShape.slice();r.length<t[1].dims.length-2&&r.push(...Array(t[1].dims.length-2-r.length).fill(0));for(let l=2;l<t[1].dims.length;++l)r[l-2]===0&&(r[l-2]=t[1].dims[l]);let n=e.pads.slice();Pn.adjustPadsBasedOnAutoPad(t[0].dims,e.strides,e.dilations,r,n,e.format==="NHWC",e.autoPad);let s=Object.assign({},e);return Object.assign(s,{kernelShape:r,pads:n}),s},Xo=e=>{let t=ca(e),r=e.format,n=["NOTSET","VALID","SAME_UPPER","SAME_LOWER"][e.auto_pad],s=e.dilations,l=e.group,a=e.kernel_shape,d=e.pads,p=e.strides,c=e.w_is_const();return{autoPad:n,format:r,dilations:s,group:l,kernelShape:a,pads:d,strides:p,wIsConst:c,...t,cacheKey:`${e.format};${t.activation};`}},ro=(e,t,r,n)=>{let s=r.format==="NHWC",l=Ip(t[0].dims,t[1].dims,r.dilations,r.pads,r.strides,s);if(r.group!==1){let F=[t[0]];if(s){let U=e.kernelCustomData.wT??e.compute(Rt(t[1],yn),{inputs:[1],outputs:[r.wIsConst?-2:-1]})[0];r.wIsConst&&!e.kernelCustomData.wT&&(e.kernelCustomData.wT=U),F.push(U)}else F.push(t[1]);t.length===3&&F.push(t[2]),!e.adapterInfo.isArchitecture("ampere")&&s&&t[1].dims[0]===r.group&&t[1].dims[1]===1&&r.dilations[0]===1&&r.dilations[1]===1?e.compute(Gm(F,r,l,n),{inputs:F}):e.compute(Ym(F,r,l,n),{inputs:F});return}let a=t.length===3,d=t[0].dims[s?1:2],p=t[0].dims[s?2:3],c=t[0].dims[s?3:1],g=t[1].dims[2],_=t[1].dims[3],w=l[s?1:2],C=l[s?2:3],x=l[s?3:1],S=s&&g===d&&_===p&&r.pads[0]===0&&r.pads[1]===0;if(S||g===1&&_===1&&r.dilations[0]===1&&r.dilations[1]===1&&r.strides[0]===1&&r.strides[1]===1&&r.pads[0]===0&&r.pads[1]===0){let F=l[0],U,k,re,oe=[];if(s){let ce=e.kernelCustomData.wT??e.compute(Rt(t[1],yn),{inputs:[1],outputs:[r.wIsConst?-2:-1]})[0];if(r.wIsConst&&!e.kernelCustomData.wT&&(e.kernelCustomData.wT=ce),S){let $e=d*p*c;U=t[0].reshape([1,F,$e]),k=ce.reshape([1,$e,x]),re=[1,F,x]}else U=t[0].reshape([F,d*p,c]),k=ce.reshape([1,c,x]),re=[F,w*C,x];oe.push(U),oe.push(k)}else U=t[0].reshape([F,c,d*p]),k=t[1].reshape([1,x,c]),re=[F,x,w*C],oe.push(k),oe.push(U);a&&oe.push(t[2]);let ye=re[2],fe=oe[0].dims[oe[0].dims.length-1];ye<8&&fe<8?e.compute(ha(oe,r,l,re,s,n),{inputs:oe}):e.compute(An(oe,r,l,re,s,n),{inputs:oe});return}let N=!0,E=e.kernelCustomData.wT??e.compute(Rt(t[1],yn),{inputs:[1],outputs:[r.wIsConst?-2:-1]})[0];r.wIsConst&&!e.kernelCustomData.wT&&(e.kernelCustomData.wT=E);let T=[t[0],E];a&&T.push(t[2]);let B=s?w*C:x,L=s?x:w*C,M=g*_*c;e.compute(qm(T,r,l,B,L,M,a,N,n),{inputs:T})},Sp=(e,t)=>{let r=t.format==="NHWC",n=[e.inputs[0].reshape(r?[e.inputs[0].dims[0],1,e.inputs[0].dims[1],e.inputs[0].dims[2]]:[e.inputs[0].dims[0],e.inputs[0].dims[1],1,e.inputs[0].dims[2]]),e.inputs[1].reshape([e.inputs[1].dims[0],e.inputs[1].dims[1],1,e.inputs[1].dims[2]])];e.inputs.length===3&&n.push(e.inputs[2]);let s=[0,t.pads[0],0,t.pads[1]],l=[1].concat(t.strides),a=[1].concat(t.dilations),d=[1].concat(t.kernelShape),p=_n({...t,pads:s,strides:l,dilations:a,kernelShape:d},n);ro(e,n,p,c=>r?[c[0],c[2],c[3]]:[c[0],c[1],c[3]])},Pp=(e,t,r)=>{let n=r.format==="NHWC"?"channelsLast":"channelsFirst",s=_n(r,t),l=r.autoPad==="NOTSET"?r.pads:r.autoPad,a=Wm(t[0].dims,t[1].dims,r.strides,r.dilations,l,!1,n);e.compute(Xm(t,s,a.outShape,[a.filterDepth,a.filterHeight,a.filterWidth],[a.padInfo.front,a.padInfo.top,a.padInfo.left],n))},Yo=(e,t)=>{if(Tp(e.inputs,t),e.inputs[0].dims.length===3)Sp(e,t);else if(e.inputs[0].dims.length===5)Pp(e,e.inputs,t);else{let r=_n(t,e.inputs);ro(e,e.inputs,r)}}}),bv=de(()=>{"use strict";Oe(),wi(),Me(),Re(),Hm=(e,t,r)=>{let n=e.length>2,s=t.outputShape,l=t.format==="NHWC",a=t.group,d=e[1].dims,p=d[2]/a,c=d[3],g=l?ut(p):1,_=l&&c===1&&p>=4,w=_?Math.floor(p/4)*4:Math.floor(p/g)*g,C=p-w,x=l?ut(c):1,S=l?c===1?g:x:1,N=V.size(s)/x,E=[Math.ceil(N/64),1,1];Ve("verbose",()=>`[conv2d_backprop_webgpu] dispatch = ${E}`);let T=["rank","rank"],B=[t.strides[0],t.strides[1]],L=[t.kernelShape[l?1:2],t.kernelShape[l?2:3]],M=[t.dilations[0],t.dilations[1]],F=[L[0]+(t.dilations[0]<=1?0:(t.kernelShape[l?1:2]-1)*(t.dilations[0]-1)),L[1]+(t.dilations[1]<=1?0:(t.kernelShape[l?2:3]-1)*(t.dilations[1]-1))],U=[F[0]-1-Math.floor((t.pads[0]+t.pads[2])/2),F[1]-1-Math.floor((t.pads[1]+t.pads[3])/2)],k=[{type:12,data:N},{type:12,data:B},{type:12,data:L},{type:12,data:M},{type:12,data:F},{type:6,data:U},{type:12,data:w},{type:12,data:p},{type:12,data:c},...Pe(e[0].dims,e[1].dims)];n&&(k.push(...Pe(e[2].dims)),T.push("rank")),k.push(...Pe(s));let re=oe=>{let ye=[{name:"output_size",type:"u32"},{name:"strides",type:"u32",length:B.length},{name:"filter_dims",type:"u32",length:L.length},{name:"dilations",type:"u32",length:L.length},{name:"effective_filter_dims",type:"u32",length:F.length},{name:"pads",type:"i32",length:U.length},{name:"input_channels_per_group_int",type:"u32"},{name:"input_channels_per_group",type:"u32"},{name:"output_channels_per_group",type:"u32"}],fe=ht(e[0].dataType),ce=l?1:2,$e=l?2:3,q=l?3:1,Y=Z("W",e[1].dataType,e[1].dims.length,S),Ie=Z("Dy",e[0].dataType,e[0].dims.length,g),Te=[Ie,Y];n&&Te.push(Z("bias",e[2].dataType,[s[q]].length,x));let be=we("result",e[0].dataType,s.length,x),ke=()=>{let ve="";if(_)g===4?ve+=`
        let xValue = ${Ie.getByOffset("x_offset")};
        let wValue = ${Y.getByOffset("w_offset")};
        dotProd = dotProd + dot(xValue, wValue);
        x_offset += 1u;
        w_offset += 1u;`:g===2?ve+=`
          dotProd = dotProd + dot(vec4<${fe}>(${Ie.getByOffset("x_offset")}, ${Ie.getByOffset("x_offset + 1u")}), vec4<${fe}>(${Y.getByOffset("w_offset")}, ${Y.getByOffset("w_offset + 1u")}));
          x_offset += 2u;
          w_offset += 2u;`:g===1&&(ve+=`
          dotProd = dotProd + dot(vec4<${fe}>(${Ie.getByOffset("x_offset")}, ${Ie.getByOffset("x_offset + 1u")}, ${Ie.getByOffset("x_offset + 2u")}, ${Ie.getByOffset("x_offset + 3u")}), vec4<${fe}>(${Y.getByOffset("w_offset")}, ${Y.getByOffset("w_offset + 1u")}, ${Y.getByOffset("w_offset + 2u")}, ${Y.getByOffset("w_offset + 3u")}));
          x_offset += 4u;
          w_offset += 4u;`);else if(ve+=`
                  let xValue = ${l?Ie.getByOffset(`${Ie.indicesToOffset(`${Ie.type.indices}(batch, idyR, idyC, inputChannel)`)} / ${g}`):Ie.get("batch","inputChannel","idyR","idyC")};
        `,g===1)ve+=`
          let w_offset = ${Y.indicesToOffset(`${Y.type.indices}(u32(wRPerm), u32(wCPerm), inputChannel, wOutChannel)`)};
          let wValue = ${Y.getByOffset(`w_offset / ${S}`)};
          dotProd = dotProd + xValue * wValue;`;else for(let me=0;me<g;me++)ve+=`
            let wValue${me} = ${Y.getByOffset(`${Y.indicesToOffset(`${Y.type.indices}(u32(wRPerm), u32(wCPerm), inputChannel + ${me}, wOutChannel)`)} / ${S}`)};
            dotProd = dotProd + xValue[${me}] * wValue${me};`;return ve},ne=()=>{if(C===0)return"";if(!_)throw new Error(`packInputAs4 ${_} is not true.`);let ve="";if(g===1){ve+="dotProd = dotProd";for(let me=0;me<C;me++)ve+=`
            + ${Ie.getByOffset(`x_offset + ${me}`)} * ${Y.getByOffset(`w_offset + ${me}`)}`;ve+=";"}else if(g===2){if(C!==2)throw new Error(`Invalid inputChannelsRemainder ${C}.`);ve+=`
          let xValue = ${Ie.getByOffset("x_offset")};
          let wValue = ${Y.getByOffset("w_offset")};
          dotProd = dotProd + dot(xValue, wValue);`}return ve},Se=`
            let outputIndices = ${be.offsetToIndices(`global_idx * ${x}`)};
            let batch = ${be.indicesGet("outputIndices",0)};
            let d1 = ${be.indicesGet("outputIndices",q)};
            let r = ${be.indicesGet("outputIndices",ce)};
            let c = ${be.indicesGet("outputIndices",$e)};
            let dyCorner = vec2<i32>(i32(r), i32(c)) - uniforms.pads;
            let dyRCorner = dyCorner.x;
            let dyCCorner = dyCorner.y;
            let groupId = d1 / uniforms.output_channels_per_group;
            let wOutChannel = d1 - groupId * uniforms.output_channels_per_group;
            // Convolve dy(?, ?, d2) with w(:, :, d1, d2) to compute dx(xR, xC, d1).
            // ? = to be determined. : = across all values in that axis.
            var dotProd = ${be.type.value}(0.0);
            var wR: u32 = 0;
            if (uniforms.dilations.x == 1) {
              // Minimum wR >= 0 that satisfies (dyRCorner + wR) % (uniforms.strides.x) == 0
              wR = u32(((dyRCorner + i32(uniforms.strides.x) - 1) / i32(uniforms.strides.x)) * i32(uniforms.strides.x) - dyRCorner);
            }
            for (; wR < uniforms.effective_filter_dims.x; wR = wR + 1) {
              if (wR % uniforms.dilations.x != 0) {
                continue;
              }
              let dyR = (${fe}(dyRCorner) + ${fe}(wR)) / ${fe}(uniforms.strides[0]);
              let wRPerm = uniforms.filter_dims.x - 1 - wR / uniforms.dilations.x;
              if (dyR < 0.0 || dyR >= ${fe}(uniforms.Dy_shape[${ce}]) || fract(dyR) > 0.0 ||
                  wRPerm < 0) {
                continue;
              }
              let idyR: u32 = u32(dyR);
              var wC: u32 = 0;
              if (uniforms.dilations.y == 1) {
                // Minimum wC >= 0 that satisfies (dyCCorner + wC) % (uniforms.strides.y) == 0
                wC = u32(((dyCCorner + i32(uniforms.strides.y) - 1) / i32(uniforms.strides.y)) * i32(uniforms.strides.y) - dyCCorner);
              }
              for (; wC < uniforms.effective_filter_dims.y; wC = wC + 1) {
                if (wC % uniforms.dilations.y != 0) {
                  continue;
                }
                let dyC = (${fe}(dyCCorner) + ${fe}(wC)) / ${fe}(uniforms.strides.y);
                let wCPerm = uniforms.filter_dims.y - 1 - wC / uniforms.dilations.y;
                if (dyC < 0.0 || dyC >= ${fe}(uniforms.Dy_shape[${$e}]) ||
                    fract(dyC) > 0.0 || wCPerm < 0) {
                  continue;
                }
                let idyC: u32 = u32(dyC);
                var inputChannel = groupId * uniforms.input_channels_per_group;
                ${_?`
                var x_offset = ${Ie.indicesToOffset(`${Ie.type.indices}(batch, idyR, idyC, inputChannel)`)} / ${g};
                var w_offset = ${Y.indicesToOffset(`${Y.type.indices}(wRPerm, wCPerm, inputChannel, wOutChannel)`)} / ${S};
                  `:""}
                for (var d2: u32 = 0; d2 < uniforms.input_channels_per_group_int; d2 = d2 + ${_?4:g}) {
                  ${ke()}
                  inputChannel = inputChannel + ${_?4:g};
                }
                ${ne()}
                wC = wC + uniforms.strides.y - 1;
              }
              wR = wR + uniforms.strides[0] - 1;
            }
            let value = dotProd${n?` + bias[d1 / ${x}]`:""};
            ${be.setByOffset("global_idx","value")};
          `;return`
    ${oe.registerUniforms(ye).declareVariables(...Te,be)}
      ${oe.mainStart()}
      ${oe.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")};
    ${Se}}`};return{name:"ConvTranspose2D",shaderCache:{hint:`${t.cacheKey};${g}${S}${x}${_}${C}`,inputDependencies:T},getRunData:()=>({dispatchGroup:{x:E[0],y:E[1],z:E[2]},outputs:[{dims:r?r(s):s,dataType:e[0].dataType}],programUniforms:k}),getShaderSource:re}}}),xv=de(()=>{"use strict";bv(),tr(),Li(),Ep=(e,t,r,n,s,l)=>(e-1)*t+r+(n-1)*s+1-l,Ap=(e,t,r,n,s)=>{let l=Math.floor(e/2);t==="SAME_UPPER"?(r[n]=l,r[s]=e-l):t==="SAME_LOWER"&&(r[n]=e-l,r[s]=l)},Op=(e,t,r,n,s,l,a,d,p,c)=>{let g=e.length-2,_=c.length===0;p.length<g&&p.push(...Array(g-p.length).fill(0));let w=e[0],C=t[d?3:1]*s;for(let x=0,S=e.length-g-(d?1:0);x<g;++x,++S){let N=e[S],E=_?N*a[x]:c[x],T=Ep(N,a[x],l[x],t[S],r[x],E);Ap(T,n,l,x,x+g),_&&c.push(a[x]*(N-1)+p[x]+(t[S]-1)*r[x]+1-l[x]-l[x+g])}c.splice(0,0,w),c.splice(d?3:1,0,C)},no=(e,t)=>{let r=e.kernelShape.slice();if(e.kernelShape.length===0||e.kernelShape.reduce((_,w)=>_*w,1)===0){r.length=0;for(let _=2;_<t[1].dims.length;++_)r.push(t[1].dims[_])}let n=e.format==="NHWC";r.splice(0,0,t[1].dims[0]),r.splice(n?3:1,0,t[1].dims[1]);let s=e.pads.slice(),l=e.outputShape.slice(),a=e.outputPadding.slice(),d=t[0].dims,p=e.dilations.slice();if(p.reduce((_,w)=>_+w,0)===0){let _=t[0].dims.length-2;p=new Array(_).fill(1)}let c=e.strides.slice();if(c.reduce((_,w)=>_+w,0)===0){let _=t[0].dims.length-2;c=new Array(_).fill(1)}Op(d,r,p,e.autoPad,e.group,s,c,n,a,l);let g=Object.assign({},e);return Object.assign(g,{kernelShape:r,pads:s,outputPadding:a,outputShape:l,dilations:p,strides:c}),g},Vm=e=>{let t=ca(e),r=e.format,n=["NOTSET","VALID","SAME_UPPER","SAME_LOWER"][typeof e.autoPad>"u"?0:e.autoPad],s=e.dilations,l=e.group??1,a=e.kernelShape,d=e.pads,p=e.strides,c=e.wIsConst(),g=e.outputPadding,_=e.outputShape;return{autoPad:n,format:r,dilations:s,group:l,kernelShape:a,outputPadding:g,outputShape:_,pads:d,strides:p,wIsConst:c,...t,cacheKey:`${e.format};${t.activation};`}},kp=(e,t)=>{if(!e||e.length!==2&&e.length!==3)throw new Error("Conv requires 2 or 3 inputs");if(e[0].dims.length!==4&&e[0].dims.length!==3)throw new Error("currently only support 2-dimensional conv");if(e[0].dims.length!==e[1].dims.length)throw new Error("filter does not have same dimension as input");let r=e[0].dims[t.format==="NHWC"?e[0].dims.length-1:1],n=e[1].dims[0];if(r!==n)throw new Error("FILTER_IN_CHANNEL should be equal to DATA_CHANNEL");let s=e[1].dims[1]*t.group;if(e.length===3&&(e[2].dims.length!==1||e[2].dims[0]!==s))throw new Error("invalid bias");let l=e[0].dims.length-2;if(t.dilations.reduce((a,d)=>a+d,0)>0&&t.dilations.length!==l)throw new Error(`dilations should be ${l}D`);if(t.strides.reduce((a,d)=>a+d,0)>0&&t.strides.length!==l)throw new Error(`strides should be ${l}D`);if(t.pads.reduce((a,d)=>a+d,0)>0&&t.pads.length!==l*2)throw new Error(`pads should be ${l*2}D`);if(t.outputPadding.length!==l&&t.outputPadding.length!==0)throw new Error(`output_padding should be ${l}D`);if(t.kernelShape.reduce((a,d)=>a+d,0)>0&&t.kernelShape.length!==0&&t.kernelShape.length!==e[1].dims.length-2)throw new Error("invalid kernel shape");if(t.outputShape.length!==0&&t.outputShape.length!==e[0].dims.length-2)throw new Error("invalid output shape")},so=(e,t,r,n)=>{let s=e.kernelCustomData.wT??e.compute(Rt(t[1],[2,3,0,1]),{inputs:[1],outputs:[r.wIsConst?-2:-1]})[0];r.wIsConst&&!e.kernelCustomData.wT&&(e.kernelCustomData.wT=s);let l=[t[0],s];t.length===3&&l.push(t[2]),e.compute(Hm(l,r,n),{inputs:l})},Np=(e,t)=>{let r=t.format==="NHWC",n=[e.inputs[0].reshape(r?[e.inputs[0].dims[0],1,e.inputs[0].dims[1],e.inputs[0].dims[2]]:[e.inputs[0].dims[0],e.inputs[0].dims[1],1,e.inputs[0].dims[2]]),e.inputs[1].reshape([e.inputs[1].dims[0],e.inputs[1].dims[1],1,e.inputs[1].dims[2]])];e.inputs.length===3&&n.push(e.inputs[2]);let s=t.kernelShape;(s.length===0||s[0]===0)&&(s=[e.inputs[1].dims[2]]);let l=t.dilations;(l.length===0||l[0]===0)&&(l=[1]);let a=t.strides;(a.length===0||a[0]===0)&&(a=[1]);let d=t.pads;d.length===0&&(d=[0,0]),d=[0,d[0],0,d[1]],a=[1].concat(a),l=[1].concat(l),s=[1].concat(s);let p=t.outputPadding;p=[0].concat(p);let c=no({...t,pads:d,strides:a,dilations:l,kernelShape:s,outputPadding:p},n);so(e,n,c,g=>r?[g[0],g[2],g[3]]:[g[0],g[1],g[3]])},jm=(e,t)=>{if(kp(e.inputs,t),e.inputs[0].dims.length===3)Np(e,t);else{let r=no(t,e.inputs);so(e,e.inputs,r)}}}),$v=de(()=>{"use strict";Oe(),Me(),dt(),Re(),Bp=(e,t,r,n)=>{let s=V.size(t),l=t.length,a=Z("input",e,l),d=we("output",e,l),p=r.dataType===6?r.getInt32Array()[0]:Number(r.getBigInt64Array()[0]),c=V.normalizeAxis(p,l),g=_=>{let w=` i32(${a.indicesGet("inputIndices","uniforms.axis")}) `,C=Ce("uniforms.input_shape","uniforms.axis",l),x=n.reverse?w+(n.exclusive?" + 1":""):"0",S=n.reverse?C:w+(n.exclusive?"":" + 1");return`
                ${_.registerUniform("outputSize","u32").registerUniform("axis","u32").declareVariables(a,d)}
                ${_.mainStart()}
                  ${_.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
                  var inputIndices = ${d.offsetToIndices("global_idx")};
                  var sum = ${d.type.value}(0);
                  let first : i32 = ${x};
                  let last : i32 = ${S};
                  for (var i : i32 = first; i < last; i++) {
                    ${a.indicesSet("inputIndices","uniforms.axis","u32(i)")};
                    sum = sum + ${a.getByIndices("inputIndices")};
                  }
                  ${d.setByOffset("global_idx","sum")};
                }`};return{name:"CumSum",shaderCache:{hint:n.cacheKey,inputDependencies:["rank"]},getRunData:()=>({outputs:[{dims:t,dataType:e}],dispatchGroup:{x:Math.ceil(s/64)},programUniforms:[{type:12,data:s},{type:12,data:c},...Pe(t,t)]}),getShaderSource:g}},Km=(e,t)=>{let r=e.inputs[0].dims,n=e.inputs[0].dataType,s=e.inputs[1];e.compute(Bp(n,r,s,t),{inputs:[0]})},Zm=e=>{let t=e.exclusive===1,r=e.reverse===1;return Ze({exclusive:t,reverse:r})}}),Cv=de(()=>{"use strict";Oe(),Me(),dt(),Re(),Lp=e=>{if(!e||e.length!==1)throw new Error("DepthToSpace requires 1 input.");if(e[0].dims.length!==4)throw new Error("DepthToSpace requires 4D input.")},Mp=(e,t,r,n)=>{let s=[];s.push(`fn perm(i: ${n.type.indices}) -> ${r.type.indices} {
    var a: ${r.type.indices};`);for(let l=0;l<t;++l)s.push(r.indicesSet("a",e[l],`i[${l}]`));return s.push("return a;}"),s.join(`
`)},Rp=(e,t)=>{let r,n,s,l,a,d,p=t.format==="NHWC",c=t.blocksize,g=t.mode==="DCR";p?([r,n,s,l]=e.dims,a=g?[r,n,s,c,c,l/c**2]:[r,n,s,l/c**2,c,c],d=g?[0,1,3,2,4,5]:[0,1,4,2,5,3]):([r,n,s,l]=[e.dims[0],e.dims[2],e.dims[3],e.dims[1]],a=g?[r,c,c,l/c**2,n,s]:[r,l/c**2,c,c,n,s],d=g?[0,3,4,1,5,2]:[0,1,4,2,5,3]);let _=e.reshape(a),w=_.dims.length,C=e.dataType,x=Z("a",C,w),S=we("output",C,w),N=E=>`
  ${E.registerUniform("output_size","u32").declareVariables(x,S)}

  ${Mp(d,w,x,S)}

  ${E.mainStart()}
    ${E.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

    let indices = ${S.offsetToIndices("global_idx")};
    let aIndices = perm(indices);

    ${S.setByOffset("global_idx",x.getByIndices("aIndices"))}
  }`;return{name:"DepthToSpace",shaderCache:{hint:`${e.dims};${t.blocksize};${t.mode}`,inputDependencies:["rank"]},getRunData:E=>{let T=p?[r,n*c,s*c,l/c**2]:[r,l/c**2,n*c,s*c],B=V.size(T),L=_.dims,M=V.sortBasedOnPerm(L,d);return{outputs:[{dims:T,dataType:E[0].dataType}],dispatchGroup:{x:Math.ceil(B/64)},programUniforms:[{type:12,data:B},...Pe(L,M)]}},getShaderSource:N}},Jm=(e,t)=>{Lp(e.inputs),e.compute(Rp(e.inputs[0],t))},Qm=e=>Ze({blocksize:e.blocksize,mode:e.mode,format:e.format})}),Iv=de(()=>{"use strict";Oe(),Me(),dt(),Re(),yi=256,Cr=512,vn=2*Math.PI,oo=e=>{let t=[],r=e;for(let n of[4,2,3,5])for(;r%n===0;)t.push(n),r/=n;return r===1?t:void 0},Pi=e=>{let t=e.toPrecision(9);return/[.eE]/.test(t)?t:`${t}.0`},Dp=(e,t,r,n,s)=>{let l=r/e,a=Cr-n,d=c=>`smem[${a}u + base + ${c*t}u]`,p=`  for (var t = local_idx; t < ${l}u; t += ${yi}u) {
`;p+=`    let twiddleIndex = t % ${t}u;
    let angleUnit = f32(twiddleIndex);
`,p+=`    var leg: array<vec2<f32>, 5>;
`;for(let c=0;c<e;c++){let g=`${n}u + t + ${c*l}u`;if(c===0)p+=`    leg[0] = smem[${g}];
`;else{let _=s*vn*c/(e*t);p+=`    { let a = ${Pi(_)} * angleUnit; leg[${c}] = cmul(smem[${g}], vec2<f32>(cos(a), sin(a))); }
`}}if(p+=`    let base = (t / ${t}u) * ${t*e}u + twiddleIndex;
`,e===2)p+=`    ${d(0)} = leg[0] + leg[1];
    ${d(1)} = leg[0] - leg[1];
`;else if(e===4){let c=s<0?"vec2<f32>(oddDiff.y, -oddDiff.x)":"vec2<f32>(-oddDiff.y, oddDiff.x)";p+=`    let evenSum = leg[0] + leg[2]; let evenDiff = leg[0] - leg[2];
`,p+=`    let oddSum = leg[1] + leg[3]; let oddDiff = leg[1] - leg[3];
`,p+=`    let oddRot = ${c};
`,p+=`    ${d(0)} = evenSum + oddSum;
    ${d(1)} = evenDiff + oddRot;
`,p+=`    ${d(2)} = evenSum - oddSum;
    ${d(3)} = evenDiff - oddRot;
`}else for(let c=0;c<e;c++){let g=["leg[0]"];for(let _=1;_<e;_++){let w=s*vn*(_*c)/e,C=Pi(Math.cos(w)),x=Pi(Math.sin(w));g.push(`vec2<f32>(leg[${_}].x*${C} - leg[${_}].y*${x}, leg[${_}].x*${x} + leg[${_}].y*${C})`)}p+=`    ${d(c)} = ${g.join(" + ")};
`}return`${p}  }
  workgroupBarrier();
`},zp=(e,t,r)=>{let n="",s=1,l=0;for(let a of e)n+=Dp(a,s,t,l,r),s*=a,l=Cr-l;return{code:n,resultOffset:l}},Fp=(e,t,r,n,s)=>{let l=e.dims,a=l.length,d=l[a-1],p=l[t],c=r&&n?(p-1)*2:p;s!==void 0&&(c=s);let g=r&&n?1:2,_=n&&!r?Math.floor(c/2)+1:c,w=l.slice();w[t]=_,w[a-1]=g;let C=1;for(let S=t+1;S<a-1;S++)C*=l[S];let x=V.size(l)/d/p;return{dataType:e.dataType,outputDims:w,length:c,signalLength:p,inner:C,batch:x,inputComponents:d,outputComponents:g,outputLength:_,inverse:r,onesided:n}},ao=(e,t)=>[t,e.length,e.inputComponents,e.outputComponents,e.inverse,e.onesided].join(";"),lo=e=>[{type:12,data:e.batch},{type:12,data:e.signalLength},{type:12,data:e.inner},{type:12,data:e.outputLength}],uo=(e,t,r)=>e.registerUniform("batch","u32").registerUniform("signalLength","u32").registerUniform("inner","u32").registerUniform("outputLength","u32").declareVariables(t,r),Up=e=>{let{dataType:t,length:r,inputComponents:n,outputComponents:s,inverse:l,onesided:a}=e,d=ft(t),p=l?1:-1,c=l?1/r:1,g=oo(r),_=w=>{let C=Z("x",t,[1]),x=we("y",t,[1]),S=M=>{let F=`inBase + (${M}) * uniforms.inner * ${n}u`,U=`f32(${C.getByOffset(F)})`,k=n===2?`f32(${C.getByOffset(`${F} + 1u`)})`:"0.0";return`vec2<f32>(${U}, ${k})`},N;if(l&&a){let M=Math.floor(r/2)+1,F=r%2===0?`select(provided, provided - 1u, provided == ${M}u)`:"provided";N=`
    let provided = min(uniforms.signalLength, ${M}u);
    for (var i = local_idx; i < ${r}u; i += ${yi}u) {
      if (i < provided) { smem[i] = ${S("i")}; } else { smem[i] = vec2<f32>(0.0); }
    }
    workgroupBarrier();
    for (var k = local_idx + 1u; k < ${F}; k += ${yi}u) {
      let h = smem[k];
      smem[${r}u - k] = vec2<f32>(h.x, -h.y);
    }
    workgroupBarrier();`}else N=`
    let loadCount = min(uniforms.signalLength, ${r}u);
    for (var i = local_idx; i < ${r}u; i += ${yi}u) {
      if (i < loadCount) { smem[i] = ${S("i")}; } else { smem[i] = vec2<f32>(0.0); }
    }
    workgroupBarrier();`;let{code:E,resultOffset:T}=zp(g,r,p),B=c===1?`smem[${T}u + i]`:`smem[${T}u + i] * ${Pi(c)}`,L=s===2?x.setByOffset("off + 1u",`${d}(v.y)`):"";return`
  ${uo(w,C,x)}
  var<workgroup> smem: array<vec2<f32>, ${2*Cr}>;
  fn cmul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
    return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
  }
  ${w.mainStart(yi)}
    let row = workgroup_index;
    if (row >= uniforms.batch) { return; }
    let outer = row / uniforms.inner;
    let within = row % uniforms.inner;
    let inBase = (outer * uniforms.signalLength * uniforms.inner + within) * ${n}u;
    let outBase = (outer * uniforms.outputLength * uniforms.inner + within) * ${s}u;
    ${N}
${E}    for (var i = local_idx; i < uniforms.outputLength; i += ${yi}u) {
      let v = ${B};
      let off = outBase + i * uniforms.inner * ${s}u;
      ${x.setByOffset("off",`${d}(v.x)`)}
      ${L}
    }
  }`};return{name:"DFT",shaderCache:{hint:ao(e,"fft"),inputDependencies:["type"]},getShaderSource:_,getRunData:()=>({outputs:[{dims:e.outputDims,dataType:t}],programUniforms:lo(e),dispatchGroup:{x:e.batch}})}},qp=e=>{let{dataType:t,length:r,inputComponents:n,outputComponents:s,inverse:l,onesided:a}=e,d=ft(t),p=l?1:-1,c=l?1/r:1,g=_=>{let w=Z("x",t,[1]),C=we("y",t,[1]),x=B=>{let L=`inBase + (${B}) * uniforms.inner * ${n}u`,M=`f32(${w.getByOffset(L)})`,F=n===2?`f32(${w.getByOffset(`${L} + 1u`)})`:"0.0";return`vec2<f32>(${M}, ${F})`},S=l&&a?`fn spectrum(inBase: u32, k: u32) -> vec2<f32> {
    let provided = min(uniforms.signalLength, ${Math.floor(r/2)+1}u);
    if (k < provided) { return ${x("k")}; }
    let m = ${r}u - k;
    if (m < provided) {
      let h = ${x("m")};
      return vec2<f32>(h.x, -h.y);
    }
    return vec2<f32>(0.0, 0.0);
  }`:`fn spectrum(inBase: u32, n: u32) -> vec2<f32> {
    if (n < uniforms.signalLength) { return ${x("n")}; }
    return vec2<f32>(0.0, 0.0);
  }`,N=`
      let angle = ${Pi(p*vn)} * f32(knMod) / ${Pi(r)};
      acc += cmul(spectrum(inBase, n), vec2<f32>(cos(angle), sin(angle)));
      knMod += k;
      if (knMod >= ${r}u) { knMod -= ${r}u; }`,E=s===2?C.setByOffset("off + 1u",`${d}(v.y)`):"",T=c===1?"acc":`acc * ${Pi(c)}`;return`
  ${uo(_,w,C)}
  fn cmul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
    return vec2<f32>(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
  }
  ${S}
  ${_.mainStart(yi)}
    let row = workgroup_index;
    if (row >= uniforms.batch) { return; }
    let outer = row / uniforms.inner;
    let within = row % uniforms.inner;
    let inBase = (outer * uniforms.signalLength * uniforms.inner + within) * ${n}u;
    let outBase = (outer * uniforms.outputLength * uniforms.inner + within) * ${s}u;
    for (var k = local_idx; k < uniforms.outputLength; k += ${yi}u) {
      var acc = vec2<f32>(0.0, 0.0);
      var knMod = 0u;
      for (var n = 0u; n < ${r}u; n++) {${N}
      }
      let v = ${T};
      let off = outBase + k * uniforms.inner * ${s}u;
      ${C.setByOffset("off",`${d}(v.x)`)}
      ${E}
    }
  }`};return{name:"DFT",shaderCache:{hint:ao(e,"direct"),inputDependencies:["type"]},getShaderSource:g,getRunData:()=>({outputs:[{dims:e.outputDims,dataType:t}],programUniforms:lo(e),dispatchGroup:{x:e.batch}})}},po=e=>{if(!e||e.dataType===0)return;if(V.size(e.dims)!==1)throw new Error("DFT optional scalar inputs must have exactly 1 element.");if(e.dataType===6)return e.getInt32Array()[0];let t=Number(e.getBigInt64Array()[0]);if(!Number.isSafeInteger(t))throw new Error("DFT optional scalar inputs are out of JavaScript safe integer range.");return t},Wp=e=>{if(!e||e.length<1)throw new Error("DFT requires at least 1 input.");let t=e[0].dims;if(t.length<2)throw new Error("DFT input must have at least 2 dimensions.");let r=t[t.length-1];if(r!==1&&r!==2)throw new Error("DFT input's innermost dimension must be 1 (real) or 2 (complex).")},eg=(e,t)=>{Wp(e.inputs);let r=e.inputs[0],n=r.dims.length,s=t.inverse!==0,l=t.onesided!==0,a=po(e.inputs[1]);if(a!==void 0&&a<=0)throw new Error("dft_length must be greater than zero.");let d=V.normalizeAxis(po(e.inputs[2])??t.axis,n);if(d===n-1)throw new Error("DFT axis must refer to a signal dimension, not the innermost (real/imaginary) dimension.");if(s&&l&&r.dims[n-1]!==2)throw new Error("Inverse one-sided DFT (IRFFT) requires complex-valued input (innermost dimension 2).");let p=Fp(r,d,s,l,a);if(p.length<=0)throw new Error(`Invalid DFT length: ${p.length}`);let c=p.length<=Cr&&oo(p.length)!==void 0?Up(p):qp(p);e.compute(c,{inputs:[0]})},tg=e=>Ze({axis:e.axis??1,inverse:e.inverse??0,onesided:e.onesided??0})}),Tv=de(()=>{"use strict";Oe(),Me(),dt(),Re(),wn="[a-zA-Z]|\\.\\.\\.",Ir="("+wn+")+",co="^"+Ir+"$",Xp="("+Ir+",)*"+Ir,Yp="^"+Xp+"$",Gp=class{constructor(e=-1){this.symbolToIndices=new Map,this.inputIndex=e}addSymbol(e,t){let r=this.symbolToIndices.get(e);r===void 0?r=[t]:r.push(t),this.symbolToIndices.set(e,r)}},Hp=class{constructor(e,t){this.equation=t,this.hasEllipsis=!1,this.symbolToInfo=new Map,this.lhs=new Array,this.outputDims=[];let[r,n]=t.includes("->")?t.split("->",2):[t,""];if(!r.match(RegExp(Yp)))throw new Error("Invalid LHS term");if(r.split(",").forEach((s,l)=>{let a=e[l].dims.slice();if(!s.match(RegExp(co)))throw new Error("Invalid LHS term");let d=this.processTerm(s,!0,a,l);this.lhs.push(d)}),n==="")n+=[...this.symbolToInfo.entries()].filter(([s,l])=>l.count===1||s==="...").map(([s])=>s).join("");else if(!n.match(RegExp(Ir)))throw new Error("Invalid RHS");n.match(RegExp(wn,"g"))?.forEach(s=>{if(s==="...")this.outputDims=this.outputDims.concat(this.ellipsisDims);else{let l=this.symbolToInfo.get(s);if(l===void 0)throw new Error("Invalid RHS symbol");this.outputDims.push(l.dimValue)}}),this.rhs=this.processTerm(n,!1,this.outputDims)}addSymbol(e,t,r){let n=this.symbolToInfo.get(e);if(n!==void 0){if(n.dimValue!==t&&n.count!==1)throw new Error("Dimension mismatch");n.count++,n.inputIndices.push(r)}else n={count:1,dimValue:t,inputIndices:[r]};this.symbolToInfo.set(e,n)}processTerm(e,t,r,n=-1){let s=r.length,l=!1,a=[],d=0;if(!e.match(RegExp(co))&&!t&&e!=="")throw new Error("Invalid LHS term");let p=e.match(RegExp(wn,"g")),c=new Gp(n);return p?.forEach((g,_)=>{if(g==="..."){if(l)throw new Error("Only one ellipsis is allowed per input term");l=!0;let w=s-p.length+1;if(w<0)throw new Error("Ellipsis out of bounds");if(a=r.slice(d,d+w),this.hasEllipsis){if(this.ellipsisDims.length!==a.length||this.ellipsisDims.toString()!==a.toString())throw new Error("Ellipsis dimensions mismatch")}else if(t)this.hasEllipsis=!0,this.ellipsisDims=a;else throw new Error("Ellipsis must be specified in the LHS");for(let C=0;C<a.length;C++){let x=String.fromCharCode(48+C);c.addSymbol(x,_+C),this.addSymbol(x,r[d++],n)}}else c.addSymbol(g,_+(this.hasEllipsis?this.ellipsisDims.length-1:0)),this.addSymbol(g,r[d++],n)}),c}},fo=e=>e+"_max",Vp=(e,t,r,n)=>{let s=e.map(c=>c.length).map((c,g)=>Z(`input${g}`,t,c)),l=V.size(n),a=we("output",t,n.length),d=[...r.symbolToInfo.keys()].filter(c=>!r.rhs.symbolToIndices.has(c)),p=c=>{let g=[],_="var prod = 1.0;",w="var sum = 0.0;",C="sum += prod;",x=[],S=[],N=[],E=[],T=r.symbolToInfo.size===r.rhs.symbolToIndices.size;r.symbolToInfo.forEach((L,M)=>{if(r.rhs.symbolToIndices.has(M)){let F=r.rhs.symbolToIndices.get(M)?.[0];F!==void 0&&r.lhs.forEach((U,k)=>{if(L.inputIndices.includes(k)){let re=U.symbolToIndices.get(M);if(re===void 0)throw new Error("Invalid symbol error");re.forEach(oe=>{g.push(`${s[k].indicesSet(`input${k}Indices`,oe,a.indicesGet("outputIndices",F))}`)})}})}else r.lhs.forEach((F,U)=>{if(L.inputIndices.includes(U)){let k=F.symbolToIndices.get(M);if(k===void 0)throw new Error("Invalid symbol error");k.forEach(re=>{x.push(`${s[U].indicesSet(`input${U}Indices`,re,`${M}`)}`)}),E.push(`prod *= ${s[U].getByIndices(`input${U}Indices`)};`)}}),S.push(`for(var ${M}: u32 = 0; ${M} < uniforms.${fo(M)}; ${M}++) {`),N.push("}")});let B=T?[...g,`let sum = ${s.map((L,M)=>L.getByIndices(`input${M}Indices`)).join(" * ")};`]:[...g,w,...S,...x,_,...E,C,...N];return`
            ${c.registerUniforms(d.map(L=>({name:`${fo(L)}`,type:"u32"}))).registerUniform("outputSize","u32").declareVariables(...s,a)}

            ${c.mainStart()}
            ${c.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
            var outputIndices = ${a.offsetToIndices("global_idx")};
            ${s.map((L,M)=>`var input${M}Indices: ${s[M].type.indices};`).join(`
`)}
            ${B.join(`
`)};
            ${a.setByOffset("global_idx","sum")};
          }`};return{name:"Einsum",shaderCache:{hint:r.equation,inputDependencies:e.map(()=>"rank")},getRunData:()=>{let c=d.filter(_=>r.symbolToInfo.has(_)).map(_=>({type:12,data:r.symbolToInfo.get(_)?.dimValue||0}));c.push({type:12,data:l});let g=e.map((_,w)=>[...Pe(_)]).reduce((_,w)=>_.concat(w),c);return g.push(...Pe(n)),{outputs:[{dims:n,dataType:t}],dispatchGroup:{x:Math.ceil(l/64)},programUniforms:g}},getShaderSource:p}},ig=(e,t)=>{let r=new Hp(e.inputs,t.equation),n=r.outputDims,s=e.inputs.map((l,a)=>l.dims);e.compute(Vp(s,e.inputs[0].dataType,r,n))},rg=e=>{let t=e.equation.replace(/\s+/g,"");return Ze({equation:t})}}),Sv=de(()=>{"use strict";Oe(),Me(),Re(),jp=e=>{if(!e||e.length!==2)throw new Error("Expand requires 2 input.");let t=e[0].dims,r=Array.from(e[1].getBigInt64Array(),Number),n=r.length<t.length?0:r.length-t.length,s=t.length<r.length?0:t.length-r.length;for(;n<r.length&&s<t.length;++n,++s)if(r[n]!==t[s]&&r[n]!==1&&t[s]!==1)throw new Error("Expand requires shape to be broadcastable to input")},ho=(e,t)=>{let r=e.length-t.length,n=[];for(let s=0;s<r;++s)n.push(e[s]);for(let s=0;s<t.length;++s)n.push(t[s]===1?e[s+r]:t[s]);return n},Kp=(e,t)=>e.length>t.length?ho(e,t):ho(t,e),Zp=e=>{let t=e[0].dims,r=Array.from(e[1].getBigInt64Array(),Number),n=Kp(t,r),s=e[0].dataType,l=s===9||V.size(t)===1,a=s===9||t.length>0&&t[t.length-1]%4===0?4:1,d=l||n.length>0&&n[n.length-1]%4===0?4:1,p=Math.ceil(V.size(n)/d),c=_=>{let w=Z("input",s,t.length,a),C=we("output",s,n.length,d),x;if(s===9){let S=(N,E,T="")=>`
          let outputIndices${E} = ${C.offsetToIndices(`outputOffset + ${E}u`)};
          let offset${E} = ${w.broadcastedIndicesToOffset(`outputIndices${E}`,C)};
          let index${E} = offset${E} / 4u;
          let component${E} = offset${E} % 4u;
          ${N}[${E}] = ${T}(${w.getByOffset(`index${E}`)}[component${E}]);
        `;x=`
        let outputOffset = global_idx * ${d};
        var data = vec4<u32>(0);
        ${S("data",0,"u32")}
        ${S("data",1,"u32")}
        ${S("data",2,"u32")}
        ${S("data",3,"u32")}
        ${C.setByOffset("global_idx","data")}
      }`}else x=`
        let outputIndices = ${C.offsetToIndices(`global_idx * ${d}`)};
        let inputOffset = ${w.broadcastedIndicesToOffset("outputIndices",C)};
        let data = ${C.type.value}(${w.getByOffset(`inputOffset / ${a}`)});
        ${C.setByOffset("global_idx","data")}
      }`;return`
    ${_.registerUniform("vec_size","u32").declareVariables(w,C)}
    ${_.mainStart()}
    ${_.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}
    ${x}`},g=[{type:12,data:p},...Pe(t,n)];return{name:"Expand",shaderCache:{hint:`${n.length};${a}${d}`,inputDependencies:["rank"]},getShaderSource:c,getRunData:()=>({outputs:[{dims:n,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(p/64)},programUniforms:g})}},ng=e=>{jp(e.inputs),e.compute(Zp(e.inputs),{inputs:[0]})}}),Pv=de(()=>{"use strict";Oe(),Me(),Re(),pa(),Jp=e=>{let t=e[0].dataType,r=V.size(e[0].dims),n=V.size(e[1].dims),s=n%4===0,l=a=>{let d=Z("x",t,[1],4),p=Z("bias",t,[1],4),c=we("y",t,[1],4),g=[{name:"output_vec_size",type:"u32"},{name:"bias_size",type:"u32"}],_=C=>`
      let bias${C}_offset: u32 = (global_idx * 4 + ${C}) % uniforms.bias_size;
      let bias${C} = ${p.getByOffset(`bias${C}_offset / 4`)}[bias${C}_offset % 4];`,w=s?`
      let bias = ${p.getByOffset("global_idx % (uniforms.bias_size / 4)")};`:`${_(0)}${_(1)}${_(2)}${_(3)}
      let bias = ${d.type.value}(bias0, bias1, bias2, bias3);`;return`${a.registerUniforms(g).declareVariables(d,p,c)}

    ${Fo(ft(t))}

    ${a.mainStart(lr)}
      ${a.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_vec_size")}

      let x = ${d.getByOffset("global_idx")};
      ${w}
      let x_in = x + bias;
      ${c.setByOffset("global_idx",Uo("x_in"))}
    }`};return{name:"FastGeluWithBias",shaderCache:{hint:`${s}`,inputDependencies:["type","type"]},getShaderSource:l,getRunData:a=>({outputs:[{dims:a[0].dims,dataType:a[0].dataType}],programUniforms:[{type:12,data:Math.ceil(r/4)},{type:12,data:n}],dispatchGroup:{x:Math.ceil(r/lr/4)}})}},sg=e=>{e.inputs.length<2||V.size(e.inputs[1].dims)===0?$m(e):e.compute(Jp(e.inputs))}}),Ev=de(()=>{"use strict";Oe(),Me(),dt(),Re(),Qp=e=>{if(!e||e.length!==2)throw new Error("Gather requires 2 inputs.")},ec=(e,t)=>{let r=e[0].dims,n=e[1].dims,s=r.length,l=V.normalizeAxis(t.axis,s),a=r.slice(0);a.splice(l,1,...n);let d=r[l],p=e[0].dataType===9?4:1,c=Math.ceil(V.size(a)/p),g=[{type:12,data:c},{type:6,data:d},{type:12,data:l},...Pe(e[0].dims,e[1].dims,a)],_=w=>{let C=Z("data",e[0].dataType,e[0].dims.length,p),x=Z("inputIndices",e[1].dataType,e[1].dims.length),S=we("output",e[0].dataType,a.length,p),N=T=>{let B=n.length,L=`var indicesIndices${T}  = ${x.type.indices}(0);`;for(let M=0;M<B;M++)L+=`${B>1?`indicesIndices${T}[${M}]`:`indicesIndices${T}`} = ${a.length>1?`outputIndices${T}[uniforms.axis + ${M}]`:`outputIndices${T}`};`;L+=`
          var idx${T} = ${x.getByIndices(`indicesIndices${T}`)};
          if (idx${T} < 0) {
            idx${T} = idx${T} + uniforms.axisDimLimit;
          }
          var dataIndices${T} : ${C.type.indices};
        `;for(let M=0,F=0;M<s;M++)M===l?(L+=`${s>1?`dataIndices${T}[${M}]`:`dataIndices${T}`} = u32(idx${T});`,F+=B):(L+=`${s>1?`dataIndices${T}[${M}]`:`dataIndices${T}`} = ${a.length>1?`outputIndices${T}[${F}]`:`outputIndices${T}`};`,F++);return L},E;if(e[0].dataType===9){let T=(B,L,M="")=>`
          let outputIndices${L} = ${S.offsetToIndices(`outputOffset + ${L}u`)};
          ${N(L)};
          let offset${L} = ${C.indicesToOffset(`dataIndices${L}`)};
          let index${L} = offset${L} / 4u;
          let component${L} = offset${L} % 4u;
          ${B}[${L}] = ${M}(${C.getByOffset(`index${L}`)}[component${L}]);
        `;E=`
        let outputOffset = global_idx * ${p};
        var value = vec4<u32>(0);
        ${T("value",0,"u32")}
        ${T("value",1,"u32")}
        ${T("value",2,"u32")}
        ${T("value",3,"u32")}
        ${S.setByOffset("global_idx","value")}
      `}else E=`
      let outputIndices = ${S.offsetToIndices("global_idx")};
      ${N("")};
      let value = ${C.getByIndices("dataIndices")};
      ${S.setByOffset("global_idx","value")};
      `;return`
      ${w.registerUniform("outputSize","u32").registerUniform("axisDimLimit","i32").registerUniform("axis","u32").declareVariables(C,x,S)}
      ${w.mainStart()}
        ${w.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
        ${E}
      }`};return{name:"Gather",shaderCache:{hint:t.cacheKey,inputDependencies:["rank","rank"]},getRunData:()=>({outputs:[{dims:a,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(c/64)},programUniforms:g}),getShaderSource:_}},og=e=>Ze({axis:e.axis}),ag=(e,t)=>{let r=e.inputs;Qp(r),e.compute(ec(e.inputs,t))}}),Av=de(()=>{"use strict";Oe(),Me(),Re(),tc=(e,t,r,n,s,l,a,d,p)=>{let c=[{type:12,data:l},{type:12,data:n},{type:12,data:s},{type:12,data:r},{type:12,data:a},{type:12,data:d},{type:12,data:p}],g=[l];c.push(...Pe(t.dims,g));let _=w=>{let C=Z("indices_data",t.dataType,t.dims.length),x=we("input_slice_offsets_data",12,1,1),S=[C,x],N=[{name:"output_size",type:"u32"},{name:"batch_dims",type:"u32"},{name:"input_dims",type:"u32",length:s.length},{name:"sizes_from_slice_dims_data",type:"u32",length:r.length},{name:"num_slices_per_batch",type:"u32"},{name:"input_batch_stride",type:"u32"},{name:"num_slice_dims",type:"u32"}];return`
  ${w.registerUniforms(N).declareVariables(...S)}
  ${w.mainStart()}
    ${w.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let batch_idx = global_idx / uniforms.num_slices_per_batch;
    let base_offset = batch_idx * uniforms.input_batch_stride;

    let slice_indices_base_offset = global_idx * uniforms.num_slice_dims;
    var relative_slice_offset = 0;
    for (var dim_idx = 0u; dim_idx < uniforms.num_slice_dims; dim_idx ++) {
      var index = i32(indices_data[dim_idx + slice_indices_base_offset].x);
      let input_dim_idx = uniforms.batch_dims + dim_idx;
      if (index < 0) {
        ${s.length===1?"index += i32(uniforms.input_dims);":"index += i32(uniforms.input_dims[input_dim_idx]);"}
      }
      ${r.length===1?"relative_slice_offset += index * i32(uniforms.sizes_from_slice_dims_data);":"relative_slice_offset += index * i32(uniforms.sizes_from_slice_dims_data[dim_idx]);"}
    }

    input_slice_offsets_data[global_idx] =  base_offset + u32(relative_slice_offset);
  }`};return e.compute({name:"computeSliceOffsets",shaderCache:{hint:`${s.length}_${r.length}`,inputDependencies:["rank"]},getRunData:()=>({outputs:[{dims:g,dataType:e.inputs[1].dataType}],dispatchGroup:{x:Math.ceil(l/64)},programUniforms:c}),getShaderSource:_},{inputs:[t],outputs:[-1]})[0]},lg=(e,t)=>{let r=e.inputs,n=r[0].dims,s=r[0].dataType,l=r[1].dims,a=l[l.length-1],d=V.sizeToDimension(l,l.length-1),p=V.sizeFromDimension(n,t.batchDims+a),c=V.sizeToDimension(n,t.batchDims),g=V.sizeFromDimension(n,t.batchDims),_=d/c,w=new Array(a),C=p;for(let L=0;L<a;++L)w[a-1-L]=C,C*=n[t.batchDims+a-1-L];let x=tc(e,r[1],w,t.batchDims,n,d,_,g,a),S=t.batchDims+a;if(S>n.length)throw new Error("last dimension of indices must not be larger than rank of input tensor");let N=l.slice(0,-1).concat(n.slice(S)),E=V.size(N),T=[{type:12,data:E},{type:12,data:p},...Pe(r[0].dims,x.dims,N)],B=L=>{let M=Z("data",r[0].dataType,r[0].dims.length),F=Z("slice_offsets",12,x.dims.length),U=we("output",r[0].dataType,N.length);return`
          ${L.registerUniform("output_size","u32").registerUniform("slice_size","u32").declareVariables(M,F,U)}
            ${L.mainStart()}
            ${L.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
          let slice_offset = slice_offsets[global_idx / uniforms.slice_size];
          output[global_idx] = data[u32(slice_offset) + global_idx % uniforms.slice_size];
        }`};e.compute({name:"GatherND",shaderCache:{hint:t.cacheKey,inputDependencies:["rank","rank"]},getRunData:()=>({outputs:[{dims:N,dataType:s}],dispatchGroup:{x:Math.ceil(E/64)},programUniforms:T}),getShaderSource:B},{inputs:[r[0],x]})},ug=e=>({batchDims:e.batch_dims,cacheKey:""})}),Ov=de(()=>{"use strict";Oe(),Me(),dt(),Re(),ic=(e,t)=>{if(e.length<3||e.length>4)throw new Error("GatherBlockQuantized requires 3 or 4 inputs.");let r=V.normalizeAxis(t.quantizeAxis,e[0].dims.length),n=t.blockSize,s=e[0],l=e[2],a=e.length===4?e[3]:void 0;if(l.dims.length!==s.dims.length||!s.dims.map((d,p)=>p===r?Math.ceil(d/n)===l.dims[p]:d===l.dims[p]).reduce((d,p)=>d&&p,!0))throw new Error("Scales must have the same rank as the input tensor and the dims should match except on gatherAxis.");if(a){if(a.dataType!==s.dataType)throw new Error("Zero point must have the same data type as the input tensor.");if(a.dims.length!==l.dims.length||!a.dims.map((d,p)=>d===l.dims[p]).reduce((d,p)=>d&&p,!0))throw new Error("Zero point must have the same rank as the input tensor and the dims should match except on quantizeAxis.")}},rc=(e,t)=>{let r=e[0].dims,n=e[1].dims,s=r.length,l=V.normalizeAxis(t.gatherAxis,s),a=V.normalizeAxis(t.quantizeAxis,s),d=r.slice(0);d.splice(l,1,...n);let p=V.size(d),c=e[2].dataType,g=e[0].dataType===22,_=[{type:12,data:p},{type:12,data:a},{type:12,data:l},{type:12,data:t.blockSize},...Pe(...e.map((C,x)=>C.dims),d)],w=C=>{let x=Z("data",e[0].dataType,e[0].dims.length),S=Z("inputIndices",e[1].dataType,e[1].dims.length),N=Z("scales",e[2].dataType,e[2].dims.length),E=e.length>3?Z("zeroPoint",e[3].dataType,e[3].dims.length):void 0,T=we("output",c,d.length),B=[x,S,N];E&&B.push(E);let L=[{name:"output_size",type:"u32"},{name:"quantize_axis",type:"u32"},{name:"gather_axis",type:"u32"},{name:"block_size",type:"u32"}];return`
        ${C.registerUniforms(L).declareVariables(...B,T)}
        ${C.mainStart()}
        let output_indices = ${T.offsetToIndices("global_idx")};
        var indices_indices = ${S.type.indices}(0);
        ${n.length>1?`
          for (var i: u32 = 0; i < ${n.length}; i++) {
            let index = ${T.indicesGet("output_indices","uniforms.gather_axis + i")};
            ${S.indicesSet("indices_indices","i","index")};
          }`:`indices_indices = ${T.indicesGet("output_indices","uniforms.gather_axis")};`};
        var data_indices = ${x.type.indices}(0);
        for (var i: u32 = 0; i < uniforms.gather_axis; i++) {
          let index = ${T.indicesGet("output_indices","i")};
          ${x.indicesSet("data_indices","i","index")};
        }
        var index_from_indices = ${S.getByIndices("indices_indices")};
        if (index_from_indices < 0) {
          index_from_indices += ${r[l]};
        }
        ${x.indicesSet("data_indices","uniforms.gather_axis","u32(index_from_indices)")};
        for (var i = uniforms.gather_axis + 1; i < ${d.length}; i++) {
          let index = ${T.indicesGet("output_indices",`i + ${n.length} - 1`)};
          ${x.indicesSet("data_indices","i","index")};
        }
        let data_offset = ${x.indicesToOffset("data_indices")};
        let data_index = data_offset % 8;
        // Convert 4-bit packed data to 8-bit packed data.
        let packed_4bit_quantized_data = ${x.getByOffset("data_offset / 8")};
        let packed_8bit_quantized_data = (packed_4bit_quantized_data >> (4 * (data_index % 2))) & 0x0f0f0f0f;
        let quantized_data_vec = ${g?"unpack4xI8":"unpack4xU8"}(u32(packed_8bit_quantized_data));
        let quantized_data = quantized_data_vec[data_index / 2];
        var scale_indices = data_indices;
        let quantize_axis_index = ${N.indicesGet("data_indices","uniforms.quantize_axis")} / uniforms.block_size;
        ${N.indicesSet("scale_indices","uniforms.quantize_axis","quantize_axis_index")};
        var scale = ${N.getByIndices("scale_indices")};
        ${E?`
              let zero_point_indices = scale_indices;
              let zero_point_offset = ${E.indicesToOffset("zero_point_indices")};
              let zero_point_index = zero_point_offset % 8;
              let packed_4bit_zero_points = ${E.getByOffset("zero_point_offset / 8")};
              let packed_8bit_zero_points = (packed_4bit_zero_points >> (4 * (zero_point_index % 2))) & 0x0f0f0f0f;
              let zero_point_vec = ${g?"unpack4xI8":"unpack4xU8"}(u32(packed_8bit_zero_points));
              let zero_point = zero_point_vec[zero_point_index / 2];`:"var zero_point = 0"};
        let dequantized_data = ${ft(c)}(quantized_data - zero_point) * scale;
        ${T.setByOffset("global_idx","dequantized_data")};
    }`};return{name:"GatherBlockQuantized",shaderCache:{hint:`${t.cacheKey};${e.filter((C,x)=>x!==1).map(C=>C.dims.join("_")).join(";")}`,inputDependencies:Array.from({length:e.length},(C,x)=>"rank")},getRunData:()=>({outputs:[{dims:d,dataType:c}],dispatchGroup:{x:Math.ceil(p/64)},programUniforms:_}),getShaderSource:w}},dg=(e,t)=>{let r=e.inputs;ic(r,t),e.compute(rc(e.inputs,t))},pg=e=>Ze({blockSize:e.blockSize,gatherAxis:e.gatherAxis,quantizeAxis:e.quantizeAxis})}),kv=de(()=>{"use strict";Oe(),Me(),dt(),Re(),nc=e=>{if(!e||e.length!==2)throw new Error("GatherElements requires 2 inputs.");if(e[0].dims.length<1)throw new Error("GatherElements requires that the data input be rank >= 1.");if(e[0].dims.length!==e[1].dims.length)throw new Error(`GatherElements requires that the data input and
                     indices input tensors be of same rank.`)},sc=(e,t)=>{let r=e[0].dims,n=e[0].dataType,s=r.length,l=e[1].dims,a=e[1].dataType,d=V.normalizeAxis(t.axis,s),p=r[d],c=l.slice(0),g=V.size(c),_=Z("input",n,s),w=Z("indicesInput",a,l.length),C=we("output",n,c.length),x=[{type:12,data:g},{type:6,data:p},{type:12,data:d}];return x.push(...Pe(r,l,c)),{name:"GatherElements",shaderCache:{inputDependencies:["rank","rank"]},getRunData:()=>({outputs:[{dims:c,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(g/64)},programUniforms:x}),getShaderSource:S=>`
      ${S.registerUniform("outputSize","u32").registerUniform("axisDimLimit","i32").registerUniform("axis","u32").declareVariables(_,w,C)}
      ${S.mainStart()}
      ${S.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}

      let outputIndices = ${C.offsetToIndices("global_idx")};

      var idx = ${w.getByOffset("global_idx")};
      if (idx < 0) {
        idx = idx + uniforms.axisDimLimit;
      }
      var inputIndices = ${_.type.indices}(outputIndices);
      ${_.indicesSet("inputIndices","uniforms.axis","u32(idx)")};
      let value = ${_.getByIndices("inputIndices")};

      ${C.setByOffset("global_idx","value")};
  }`}},cg=e=>Ze({axis:e.axis}),fg=(e,t)=>{let r=e.inputs;nc(r),e.compute(sc(e.inputs,t))}}),Nv=de(()=>{"use strict";Oe(),Me(),Re(),oc=e=>{if(!e)throw new Error("Input is missing");if(e.length<2||e.length>3)throw new Error("Invaid input number.");if(e.length===3&&e[2].dims.length>2)throw new Error("Invalid input shape of C");if(e[0].dataType!==e[1].dataType||e.length===3&&e[0].dataType!==e[2].dataType)throw new Error("Input types are mismatched")},ac=(e,t)=>{let r=e[0].dims.slice(),n=e[1].dims.slice(),[s,l,a]=uh.getShapeOfGemmResult(r,t.transA,n,t.transB,e.length===3?e[2].dims:void 0),d=[s,l];if(!d)throw new Error("Can't use gemm on the given tensors");let p=16,c=Math.ceil(l/p),g=Math.ceil(s/p),_=!0,w=V.size(d),C=[{type:12,data:_?c:w},{type:12,data:s},{type:12,data:l},{type:12,data:a},{type:1,data:t.alpha},{type:1,data:t.beta}],x=["type","type"];e.length===3&&(C.push(...Pe(e[2].dims)),x.push("rank")),C.push(...Pe(d));let S=E=>{let T="";t.transA&&t.transB?T="value += a[k * uniforms.M + m] * b[n * uniforms.K + k];":t.transA&&!t.transB?T="value += a[k * uniforms.M + m] * b[k * uniforms.N + n];":!t.transA&&t.transB?T="value += a[m * uniforms.K + k] * b[n * uniforms.K + k];":!t.transA&&!t.transB&&(T="value += a[m * uniforms.K + k] * b[k * uniforms.N + n];");let B=t.alpha===1?"":"value *= uniforms.alpha;",L=Z("a",e[0].dataType,e[0].dims),M=Z("b",e[1].dataType,e[1].dims),F=L.type.value,U=null,k=[L,M];e.length===3&&(U=Z("c",e[2].dataType,e[2].dims.length),k.push(U));let re=we("output",e[0].dataType,d.length);k.push(re);let oe=[{name:"output_size",type:"u32"},{name:"M",type:"u32"},{name:"N",type:"u32"},{name:"K",type:"u32"},{name:"alpha",type:"f32"},{name:"beta",type:"f32"}];return`
  ${E.registerUniforms(oe).declareVariables(...k)}

  ${E.mainStart()}
    ${E.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

    let m = global_idx / uniforms.N;
    let n = global_idx % uniforms.N;

    var value = ${F}(0);
    for (var k: u32 = 0u; k < uniforms.K; k++) {
      ${T}
    }

    ${B}
    ${U!=null?`let cOffset = ${U.broadcastedIndicesToOffset("vec2(m, n)",re)}; value += ${F}(uniforms.beta) * ${U.getByOffset("cOffset")};`:""}
    output[global_idx] = value;
  }`},N=E=>{let T=Z("a",e[0].dataType,e[0].dims),B=Z("b",e[1].dataType,e[1].dims),L=null,M=[T,B];e.length===3&&(L=Z("c",e[2].dataType,e[2].dims.length),M.push(L));let F=we("output",e[0].dataType,d.length);M.push(F);let U=[{name:"num_tile_n",type:"u32"},{name:"M",type:"u32"},{name:"N",type:"u32"},{name:"K",type:"u32"},{name:"alpha",type:"f32"},{name:"beta",type:"f32"}],k="",re="";t.transA&&t.transB?(re=`
      var col = tile_row_start + local_id.x;
      var row = k_start + local_id.y;
      if (col < uniforms.M && row < uniforms.K) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.M + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${T.type.value}(0);
      }

      col = k_start + local_id.x;
      row = tile_col_start + local_id.y;
      if (col < uniforms.K && row < uniforms.N) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.K + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${B.type.value}(0);
      }
      `,k="value += tile_a[k][local_id.y] * tile_b[local_id.x][k];"):t.transA&&!t.transB?(re=`
      var col = tile_row_start + local_id.x;
      var row = k_start + local_id.y;
      if (col < uniforms.M && row < uniforms.K) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.M + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${T.type.value}(0);
      }

      col = tile_col_start + local_id.x;
      row = k_start + local_id.y;
      if (col < uniforms.N && row < uniforms.K) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.N + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${B.type.value}(0);
      }
      `,k="value += tile_a[k][local_id.y] * tile_b[k][local_id.x];"):!t.transA&&t.transB?(re=`
      var col = k_start + local_id.x;
      var row = tile_row_start + local_id.y;
      if (col < uniforms.K && row < uniforms.M) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.K + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${T.type.value}(0);
      }

      col = k_start + local_id.x;
      row = tile_col_start + local_id.y;
      if (col < uniforms.K && row < uniforms.N) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.K + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${B.type.value}(0);
      }
      `,k="value += tile_a[local_id.y][k] * tile_b[local_id.x][k];"):!t.transA&&!t.transB&&(re=`
      var col = k_start + local_id.x;
      var row = tile_row_start + local_id.y;
      if (col < uniforms.K && row < uniforms.M) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.K + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${T.type.value}(0);
      }

      col = tile_col_start + local_id.x;
      row = k_start + local_id.y;
      if (col < uniforms.N && row < uniforms.K) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.N + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${B.type.value}(0);
      }
      `,k="value += tile_a[local_id.y][k] * tile_b[k][local_id.x];");let oe=t.alpha===1?"":"value *= uniforms.alpha;";return`
  ${E.registerUniforms(U).declareVariables(...M)}
  var<workgroup> tile_a: array<array<${T.type.storage}, ${p}>, ${p}>;
  var<workgroup> tile_b: array<array<${B.type.storage}, ${p}>, ${p}>;
  ${E.mainStart([p,p,1])}
    let tile_col_start = (workgroup_index % uniforms.num_tile_n) * ${p};
    let tile_row_start = (workgroup_index / uniforms.num_tile_n) * ${p};
    let num_tiles = (uniforms.K - 1) / ${p} + 1;
    var k_start = 0u;
    var value = ${F.type.value}(0);
    for (var t: u32 = 0u; t < num_tiles; t++) {
      ${re}
      k_start = k_start + ${p};
      workgroupBarrier();

      for (var k: u32 = 0u; k < ${p}; k++) {
        ${k}
      }
      workgroupBarrier();
    }

    ${oe}
    let m = tile_row_start + local_id.y;
    let n = tile_col_start + local_id.x;
    ${L!=null?`let cOffset = ${L.broadcastedIndicesToOffset("vec2(m, n)",F)}; value += ${F.type.value}(uniforms.beta) * ${L.getByOffset("cOffset")};`:""}
    if (m < uniforms.M && n < uniforms.N) {
      output[m * uniforms.N + n] = value;
    }
  }`};return _?{name:"GemmShared",shaderCache:{hint:`${t.cacheKey}`,inputDependencies:x},getRunData:()=>({outputs:[{dims:d,dataType:e[0].dataType}],dispatchGroup:{x:c*g},programUniforms:C}),getShaderSource:N}:{name:"Gemm",shaderCache:{hint:`${t.cacheKey}`,inputDependencies:x},getRunData:()=>({outputs:[{dims:d,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(w/64)},programUniforms:C}),getShaderSource:S}},hg=e=>{let t=e.transA,r=e.transB,n=e.alpha,s=e.beta;return{transA:t,transB:r,alpha:n,beta:s,cacheKey:`${e.transA};${e.transB};${e.alpha===1}`}},mg=(e,t)=>{oc(e.inputs),e.compute(ac(e.inputs,t))}}),Bv=de(()=>{"use strict";Oe(),Me(),dt(),Re(),[di,_i,Wi,Xi]=[0,1,2,3],lc=e=>{if(e[0].dims.length!==4)throw new Error("only 4-D tensor is supported.");if(e[0].dims.length!==e[1].dims.length)throw new Error("input dimensions must be equal to grid dimensions");if(e[0].dims.length-2!==e[1].dims[e[1].dims.length-1])throw new Error(`last dimension of grid must be equal to ${e[0].dims.length-2}`);if(e[0].dims[0]!==e[1].dims[0])throw new Error("grid batch size must match input batch size")},uc=`
  fn gs_get_cubic_coeffs(x: f32) -> vec4<f32> {
    let cubic_alpha = -0.75f;
    let x_abs = abs(x);
    var coeffs: vec4<f32>;
    coeffs[0] = (((cubic_alpha * (x_abs + 1) - 5 * cubic_alpha) * (x_abs + 1) + 8 * cubic_alpha) * (x_abs + 1) - 4 * cubic_alpha);
    coeffs[1] = (((cubic_alpha + 2) * x_abs - (cubic_alpha + 3)) * x_abs * x_abs + 1);
    coeffs[2] = (((cubic_alpha + 2) * (1 - x_abs) - (cubic_alpha + 3)) * (1 - x_abs) * (1 - x_abs) + 1);
    coeffs[3] = (((cubic_alpha * (2 - x_abs) - 5 * cubic_alpha) * (2 - x_abs) + 8 * cubic_alpha) * (2 - x_abs) - 4 * cubic_alpha);
    return coeffs;
  }
`,dc=e=>`
  fn gs_bicubic_interpolate(p: mat4x4<${e}>, x: f32, y: f32) -> ${e} {
    var v: vec4<f32>;
    var coeffs = gs_get_cubic_coeffs(x);
    for (var i = 0; i < 4; i++) {
      v[i] = coeffs[0] * p[i][0] + coeffs[1] * p[i][1] + coeffs[2] * p[i][2] + coeffs[3] * p[i][3];
    }
    coeffs = gs_get_cubic_coeffs(y);
    let pixel = ${e}(coeffs[0] * v[0] + coeffs[1] * v[1] + coeffs[2] * v[2] + coeffs[3] * v[3]);
    return pixel;
  }
`,pc=e=>`
  fn gs_denormalize(n: f32, length: i32) -> f32 {
    ${e.alignCorners===0?`
    // alignCorners: false => [-1, 1] to [-0.5, length - 0.5]
    return ((n + 1.0) * f32(length) - 1.0) / 2.0;
    `:`
    // alignCorners: true => [-1, 1] to [0, length - 1]
    return (n + 1.0) / 2.0 * (f32(length - 1));
    `}
  }
`,cc=e=>`
  ${e.paddingMode==="reflection"?`
      fn gs_reflect(x: i32, x_min: f32, x_max: f32) -> u32 {
        var dx = 0.0;
        var fx = f32(x);
        let range = x_max - x_min;
        if (fx < x_min) {
          dx = x_min - fx;
          let n = u32(dx / range);
          let r = dx - f32(n) * range;
          if (n % 2 == 0) {
            fx = x_min + r;
          } else {
            fx = x_max - r;
          }
        } else if (fx > x_max) {
          dx = fx - x_max;
          let n = u32(dx / range);
          let r = dx - f32(n) * range;
          if (n % 2 == 0) {
            fx = x_max - r;
          } else {
            fx = x_min + r;
          }
        }
        return u32(fx);
      }`:""}
`,fc=(e,t,r)=>`
  fn pixel_at_grid(r: i32, c: i32, H: i32, W: i32, batch: u32, channel: u32, border: vec4<f32>) -> ${t} {
     var pixel = ${t}(0);
     var indices = vec4<u32>(0);
     indices[${di}] = batch;
     indices[${_i}] = channel;`+(()=>{switch(r.paddingMode){case"zeros":return`
          if (r >= 0 && r < H && c >=0 && c < W) {
            indices[${Wi}] = u32(r);
            indices[${Xi}] = u32(c);
          } else {
            return ${t}(0);
          }
        `;case"border":return`
          indices[${Wi}] = u32(clamp(r, 0, H - 1));
          indices[${Xi}] = u32(clamp(c, 0, W - 1));
        `;case"reflection":return`
          indices[${Wi}] = gs_reflect(r, border[1], border[3]);
          indices[${Xi}] = gs_reflect(c, border[0], border[2]);
        `;default:throw new Error(`padding mode ${r.paddingMode} is not supported`)}})()+`
    return ${e.getByIndices("indices")};
  }
`,hc=(e,t,r)=>(()=>{switch(r.mode){case"nearest":return`
          let result = pixel_at_grid(i32(round(y)), i32(round(x)), H_in, W_in, indices[${di}], indices[${_i}], border);
        `;case"bilinear":return`
          let x1 = i32(floor(x));
          let y1 = i32(floor(y));
          let x2 = x1 + 1;
          let y2 = y1 + 1;

          let p11 = pixel_at_grid(y1, x1, H_in, W_in, indices[${di}], indices[${_i}], border);
          let p12 = pixel_at_grid(y1, x2, H_in, W_in, indices[${di}], indices[${_i}], border);
          let p21 = pixel_at_grid(y2, x1, H_in, W_in, indices[${di}], indices[${_i}], border);
          let p22 = pixel_at_grid(y2, x2, H_in, W_in, indices[${di}], indices[${_i}], border);

          let dx2 = ${t}(f32(x2) - x);
          let dx1 = ${t}(x - f32(x1));
          let dy2 = ${t}(f32(y2) - y);
          let dy1 = ${t}(y - f32(y1));
          let result = dy2 * (dx2 * p11 + dx1 * p12) + dy1 * (dx2 * p21 + dx1 * p22);
        `;case"bicubic":return`
          let x0 = i32(floor(x)) - 1;
          let y0 = i32(floor(y)) - 1;
          var p: mat4x4<${t}>;
          for (var h = 0; h < 4; h++) {
            for (var w = 0; w < 4; w++) {
              p[h][w] = pixel_at_grid(h + y0, w + x0, H_in, W_in, indices[${di}], indices[${_i}], border);
            }
          }

          let dx = x - f32(x0 + 1);
          let dy = y - f32(y0 + 1);
          let result = gs_bicubic_interpolate(p, dx, dy);
        `;default:throw new Error(`mode ${r.mode} is not supported`)}})()+`${e.setByOffset("global_idx","result")}`,mc=(e,t)=>{let r=Z("x",e[0].dataType,e[0].dims.length),n=[e[1].dims[0],e[1].dims[1],e[1].dims[2]],s=Z("grid",e[1].dataType,n.length,2),l=[e[0].dims[0],e[0].dims[1],e[1].dims[1],e[1].dims[2]];t.format==="NHWC"&&(l=[e[0].dims[0],e[1].dims[1],e[1].dims[2],e[0].dims[3]],[di,_i,Wi,Xi]=[0,3,1,2]);let a=we("output",e[0].dataType,l.length),d=r.type.value,p=V.size(l),c=[{type:12,data:p},...Pe(e[0].dims,n,l)],g=_=>`
  ${_.registerUniform("output_size","u32").declareVariables(r,s,a)}
  ${uc}
  ${dc(d)}
  ${pc(t)}
  ${cc(t)}
  ${fc(r,d,t)}

  ${_.mainStart()}
    ${_.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
      let H_in = i32(uniforms.x_shape[${Wi}]);
      let W_in = i32(uniforms.x_shape[${Xi}]);

      ${t.alignCorners===0?`
      let x_min = -0.5;
      let x_max = f32(W_in) - 0.5;
      let y_min = -0.5;
      let y_max = f32(H_in) - 0.5;
      `:`
      let x_min = 0.0;
      let x_max = f32(W_in) - 1.0;
      let y_min = 0.0;
      let y_max = f32(H_in) - 1.0;
      `};
      let border = vec4<f32>(x_min, y_min, x_max, y_max);

      let indices = ${a.offsetToIndices("global_idx")};
      var grid_indices = vec3<u32>(indices[${di}], indices[${Wi}], indices[${Xi}]);
      let nxy = ${s.getByIndices("grid_indices")};
      var x = gs_denormalize(f32(nxy[0]), W_in);
      var y = gs_denormalize(f32(nxy[1]), H_in);

      ${hc(a,d,t)}
  }`;return{name:"GridSample",shaderCache:{hint:`${t.cacheKey}`,inputDependencies:["type","type"]},getRunData:_=>{let w=V.size(l);return{outputs:[{dims:l,dataType:_[0].dataType}],dispatchGroup:{x:Math.ceil(w/64)},programUniforms:c}},getShaderSource:g}},gg=(e,t)=>{lc(e.inputs),e.compute(mc(e.inputs,t))},yg=e=>Ze({alignCorners:e.align_corners,mode:e.mode,paddingMode:e.padding_mode,format:e.format})}),wg=de(()=>{"use strict";Oe(),Me(),dt(),aa(),da(),Re(),Li(),It=(e,t)=>e.length>t&&e[t].dims.length>0?e[t]:void 0,gc=(e,t)=>{let r=e[0],n=It(e,1),s=It(e,2),l=It(e,3),a=It(e,4),d=It(e,5),p=It(e,6),c=It(e,7);if(r.dims.length!==3&&r.dims.length!==5)throw new Error("Input query is expected to have 3 or 5 dimensions");let g=r.dims[0],_=r.dims[1],w=r.dims.length===3?r.dims[2]:t.numHeads*r.dims[4],C=_,x=0,S=0,N=Math.floor(w/t.numHeads);if(p&&c&&V.size(p.dims)&&V.size(c.dims)){if(p.dims.length!==4)throw new Error('Input "past_key" is expected to have 4 dimensions');if(p.dims[0]!==g||p.dims[1]!==t.numHeads||p.dims[3]!==N)throw new Error('Input "past_key" shape (batch_size, num_heads, past_sequence_length, head_size)');if(c.dims[0]!==g||c.dims[1]!==t.numHeads||c.dims[3]!==N)throw new Error('Input "past_value" shape (batch_size, num_heads, past_sequence_length, head_size)');if(p.dims[2]!==c.dims[2])throw new Error('Input "past_key" and "past_value" shall have same dim 2 (past_sequence_length)');if(c.dims.length!==4)throw new Error('Input "past_value" is expected to have 4 dimensions');x=p.dims[2],S=p.dims[2]}else if(p&&V.size(p.dims)||c&&V.size(c.dims))throw new Error('Input "past_key" and "past_value" shall be both present or both absent');let E;if(n&&V.size(n.dims)>0){if(r.dims.length!==3)throw new Error('Input "query" is expected to have 3 dimensions when key is given');if(n.dims.length<3||n.dims.length>5)throw new Error('Input "key" is expected to have 3, 4, or 5 dimensions');if(r.dims[0]!==n.dims[0])throw new Error('Input "query" and "key" shall have same dim 0 (batch size)');if(n.dims.length===3){if(n.dims[2]!==r.dims[2])throw new Error('Input "query" and "key" shall have same dim 2 (hidden_size)');E=2,C=n.dims[1]}else if(n.dims.length===5){if(n.dims[2]!==t.numHeads||n.dims[3]!==2||n.dims[4]!==N)throw new Error('Expect "key" shape (batch_size, kv_sequence_length, num_heads, 2, head_size) for packed kv');if(s)throw new Error('Expect "value" be none when "key" has packed kv format.');E=5,C=n.dims[1]}else{if(n.dims[1]!==t.numHeads||n.dims[3]!==N)throw new Error('Expect "key" shape (batch_size, num_heads, kv_sequence_length, head_size) for past_key');E=0,C=n.dims[2]}}else{if(r.dims.length!==5)throw new Error('Input "query" is expected to have 5 dimensions when key is empty');if(r.dims[2]!==t.numHeads||r.dims[3]!==3)throw new Error('Expect "query" shape (batch_size, kv_sequence_length, num_heads, 3, head_size) for packed kv');E=3}if(l&&V.size(l.dims)>0){if(l.dims.length!==1)throw new Error('Input "bias" is expected to have 1 dimension');if(n&&n.dims.length===5&&n.dims[3]===2)throw new Error("bias is not allowed for packed kv.")}let T=x+C,B=0;if(a&&V.size(a.dims)>0){B=8;let U=a.dims;throw U.length===1?U[0]===g?B=1:U[0]===3*g+2&&(B=3):U.length===2&&U[0]===g&&U[1]===T&&(B=5),B===8?new Error('Input "key_padding_mask" shape shall be (batch_size) or (batch_size, total_sequence_length)'):new Error("Mask not supported")}let L=!1,M=w;if(s&&V.size(s.dims)>0){if(s.dims.length!==3&&s.dims.length!==4)throw new Error('Input "value" is expected to have 3 or 4 dimensions');if(r.dims[0]!==s.dims[0])throw new Error('Input "query" and "value" shall have same dim 0 (batch_size)');if(s.dims.length===3){if(C!==s.dims[1])throw new Error('Input "key" and "value" shall have the same dim 1 (kv_sequence_length)');M=s.dims[2]}else{if(C!==s.dims[2])throw new Error('Input "key" and "value" shall have the same dim 2 (kv_sequence_length)');M=s.dims[1]*s.dims[3],L=!0}}let F=!1;if(a&&V.size(a.dims)>0)throw new Error("Key padding mask is not supported");if(d&&V.size(d.dims)>0){if(d.dims.length!==4)throw new Error('Input "attention_bias" is expected to have 4 dimensions');if(d.dims[0]!==g||d.dims[1]!==t.numHeads||d.dims[2]!==_||d.dims[3]!==T)throw new Error('Expect "attention_bias" shape (batch_size, num_heads, sequence_length, total_sequence_length)')}return{batchSize:g,sequenceLength:_,pastSequenceLength:x,kvSequenceLength:C,totalSequenceLength:T,maxSequenceLength:S,inputHiddenSize:0,hiddenSize:w,vHiddenSize:M,headSize:N,vHeadSize:Math.floor(M/t.numHeads),numHeads:t.numHeads,isUnidirectional:!1,pastPresentShareBuffer:!1,maskFilterValue:t.maskFilterValue,maskType:B,scale:t.scale,broadcastResPosBias:F,passPastInKv:L,qkvFormat:E}},_g=e=>Ze({...e}),mo=Ze({perm:[0,2,1,3]}),yc=(e,t,r,n,s,l,a)=>{let d=[n,s,l],p=V.size(d),c=[{type:12,data:p},{type:12,data:a},{type:12,data:l}],g=_=>{let w=we("qkv_with_bias",t.dataType,d),C=Z("qkv",t.dataType,d),x=Z("bias",r.dataType,d),S=[{name:"output_size",type:"u32"},{name:"bias_offset",type:"u32"},{name:"hidden_size",type:"u32"}];return`
  ${_.registerUniforms(S).declareVariables(C,x,w)}
  ${_.mainStart()}
    ${_.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let bias_offset_idx = (global_idx % uniforms.hidden_size) + uniforms.bias_offset;

    qkv_with_bias[global_idx] = qkv[global_idx] + bias[bias_offset_idx];
  }`};return e.compute({name:"MultiHeadAttentionAddBias",shaderCache:{inputDependencies:["type","type"]},getRunData:()=>({outputs:[{dims:d,dataType:t.dataType,gpuDataType:0}],dispatchGroup:{x:Math.ceil(p/64)},programUniforms:c}),getShaderSource:g},{inputs:[t,r],outputs:[-1]})[0]},kr=(e,t,r,n,s,l,a,d)=>{let p=l;if(a&&V.size(a.dims)>0){if(n===1)throw new Error("AddBiasReshape is not implemented. Please export your model with packed QKV or KV");return p=yc(e,l,a,t,n,r*s,d),p=p.reshape([t,n,r,s]),r===1||n===1?p:e.compute(Rt(p,mo.perm),{inputs:[p],outputs:[-1]})[0]}else return l.dims.length===3&&(p=l.reshape([t,n,r,s])),r===1||n===1?p:e.compute(Rt(p,mo.perm),{inputs:[p],outputs:[-1]})[0]},vg=(e,t)=>{let r=gc(e.inputs,t),n=e.inputs[0],s=It(e.inputs,1),l=It(e.inputs,2),a=It(e.inputs,3),d=It(e.inputs,4),p=It(e.inputs,5),c=It(e.inputs,6),g=It(e.inputs,7);if(n.dims.length===5)throw new Error("Packed QKV is not implemented");if(s?.dims.length===5)throw new Error("Packed KV is not implemented");let _=s&&l&&s.dims.length===4&&l.dims.length===4,w=kr(e,r.batchSize,r.numHeads,r.sequenceLength,r.headSize,n,a,0);if(_)return Mr(e,w,s,l,d,void 0,c,g,p,r);if(!s||!l)throw new Error("key and value must be provided");let C=kr(e,r.batchSize,r.numHeads,r.kvSequenceLength,r.headSize,s,a,r.hiddenSize),x=kr(e,r.batchSize,r.numHeads,r.kvSequenceLength,r.vHeadSize,l,a,2*r.hiddenSize);Mr(e,w,C,x,d,void 0,c,g,p,r)}}),$g=de(()=>{"use strict";Oe(),Me(),dt(),Re(),_c=e=>{if(!e||e.length<1)throw new Error("too few inputs")},vc=(e,t)=>{let r=[],n=t.numOutputs;return e[1].dims[0]>0&&(e[1].getBigInt64Array().forEach(s=>r.push(Number(s))),n=r.length),Ze({numOutputs:n,axis:t.axis,splitSizes:r})},wc=e=>`
fn calculateOutputIndex(index: u32) -> u32 {
    for (var i: u32 = 0u; i < ${e}u; i += 1u ) {
    if (index < ${Ce("uniforms.size_in_split_axis","i",e)}) {
        return i;
    }
    }
    return ${e}u;
}`,bc=e=>{let t=e.length,r=[];for(let n=0;n<t;++n){let s=e[n].setByIndices("indices","input[global_idx]");t===1?r.push(s):n===0?r.push(`if (output_number == ${n}u) { ${s} }`):n===t-1?r.push(`else { ${s} }`):r.push(`else if (output_number == ${n}) { ${s} }`)}return`
      fn writeBufferData(output_number: u32, indices: ${e[0].type.indices}, global_idx: u32) {
        ${r.join(`
`)}
      }`},Go=(e,t)=>{let r=e[0].dims,n=V.size(r),s=e[0].dataType,l=V.normalizeAxis(t.axis,r.length),a=new Array(t.numOutputs),d=Z("input",s,r.length),p=new Array(t.numOutputs),c=[],g=[],_=0,w=[{type:12,data:n}];for(let x=0;x<t.numOutputs;x++){_+=t.splitSizes[x],p[x]=_;let S=r.slice();S[l]=t.splitSizes[x],g.push(S),a[x]=we(`output${x}`,s,S.length),c.push({dims:g[x],dataType:e[0].dataType})}w.push({type:12,data:p},...Pe(r,...g));let C=x=>`
  ${x.registerUniform("input_size","u32").registerUniform("size_in_split_axis","u32",p.length).declareVariables(d,...a)}
  ${wc(p.length)}
  ${bc(a)}

  ${x.mainStart()}
    ${x.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.input_size")}

    var indices = ${d.offsetToIndices("global_idx")};
    var index = ${d.indicesGet("indices",l)};
    let output_number = calculateOutputIndex(index);
    if (output_number != 0) {
      index -= ${Ce("uniforms.size_in_split_axis","output_number - 1u",p.length)};
      ${d.indicesSet("indices",l,"index")};
    }
    writeBufferData(output_number, indices, global_idx);
  }`;return{name:"Split",shaderCache:{hint:t.cacheKey,inputDependencies:["rank"]},getShaderSource:C,getRunData:()=>({outputs:c,dispatchGroup:{x:Math.ceil(n/64)},programUniforms:w})}},bg=(e,t)=>{_c(e.inputs);let r=e.inputs.length===1?t:vc(e.inputs,t);e.compute(Go(e.inputs,r),{inputs:[0]})},xg=e=>{let t=e.axis,r=e.splitSizes,n=e.numOutputs<0?r.length:e.numOutputs;if(n!==r.length)throw new Error("numOutputs and splitSizes length must be equal");return Ze({axis:t,numOutputs:n,splitSizes:r})}}),Ig=de(()=>{"use strict";Oe(),Me(),dt(),Re(),xc=(e,t)=>{let[r,n,s,l]=e,{numHeads:a,rotaryEmbeddingDim:d}=t;if(r.dims.length!==3&&r.dims.length!==4)throw new Error(`Input 'x' is expected to have 3 or 4 dimensions, got ${r.dims.length}`);if(!V.areEqual(n.dims,[])&&!V.areEqual(n.dims,[1])&&n.dims.length!==2)throw new Error(`Input 'position_ids' is expected to have 0, 1, or 2 dimensions, got ${n.dims.length}`);if(s.dims.length!==2)throw new Error(`Input 'cos_cache' is expected to have 2 dimensions, got ${s.dims.length}`);if(l.dims.length!==2)throw new Error(`Input 'sin_cache' is expected to have 2 dimensions, got ${l.dims.length}`);if(!V.areEqual(s.dims,l.dims))throw new Error("Inputs 'cos_cache' and 'sin_cache' are expected to have the same shape");if(d>0&&a===0)throw new Error("num_heads must be provided if rotary_embedding_dim is specified");let p=r.dims[0],c=r.dims[r.dims.length-2],g=s.dims[0],_=V.sizeFromDimension(r.dims,1)/c,w=d===0?s.dims[1]*2:_/a;if(d>w)throw new Error("rotary_embedding_dim must be less than or equal to head_size");if(n.dims.length===2){if(p!==n.dims[0])throw new Error(`Input 'position_ids' dimension 0 should be of size batch_size, got ${n.dims[0]}`);if(c!==n.dims[1])throw new Error(`Input 'position_ids' dimension 1 should be of size sequence_length, got ${n.dims[1]}`)}if(c>g)throw new Error("Updating cos_cache and sin_cache in RotaryEmbedding is not currently supported");if(w/2!==s.dims[1]&&d/2!==s.dims[1])throw new Error(`Input 'cos_cache' dimension 1 should be same as head_size / 2 or rotary_embedding_dim / 2, got ${s.dims[1]}`)},On=(e,t)=>{let{interleaved:r,numHeads:n,rotaryEmbeddingDim:s,scale:l}=t,a=e[0].dims[0],d=V.sizeFromDimension(e[0].dims,1),p=e[0].dims[e[0].dims.length-2],c=d/p,g=e[2].dims[1],_=s===0?g*2:c/n,w=new Array(a,p,c/_,_-g),C=V.computeStrides(w),x=[{type:1,data:l},{type:12,data:w},{type:12,data:C},...e[0].dims.length===3?new Array({type:12,data:[d,c,_,1]}):[],...e[0].dims.length===4?new Array({type:12,data:[d,_,p*_,1]}):[],...Pe(e[0].dims,e[1].dims,e[2].dims,e[3].dims,e[0].dims)],S=N=>{let E=Z("input",e[0].dataType,e[0].dims.length),T=Z("position_ids",e[1].dataType,e[1].dims.length),B=Z("cos_cache",e[2].dataType,e[2].dims.length),L=Z("sin_cache",e[3].dataType,e[3].dims.length),M=we("output",e[0].dataType,e[0].dims.length);return N.registerUniforms([{name:"scale",type:"f32"},{name:"global_shape",type:"u32",length:w.length},{name:"global_strides",type:"u32",length:C.length},{name:"input_output_strides",type:"u32",length:C.length}]),`
        ${N.declareVariables(E,T,B,L,M)}

        ${N.mainStart(lr)}
          let half_rotary_emb_dim = uniforms.${B.name}_shape[1];
          let bsnh = global_idx / uniforms.global_strides % uniforms.global_shape;
          let size = uniforms.global_shape[0] * uniforms.global_strides[0];
          ${N.guardAgainstOutOfBoundsWorkgroupSizes("size")}

          if (bsnh[3] < half_rotary_emb_dim) {
            let position_ids_idx =
                ${T.broadcastedIndicesToOffset("bsnh.xy",we("",T.type.tensor,2))};
            let position_id =
                u32(${T.getByOffset("position_ids_idx")}) + select(0, bsnh[1], position_ids_idx == 0);
            let i = dot(bsnh, uniforms.input_output_strides) + select(0, bsnh[3], ${r});
            let j = i + select(half_rotary_emb_dim, 1, ${r});
            let re = ${E.getByOffset("i")} * ${B.get("position_id","bsnh[3]")} -
                ${E.getByOffset("j")} * ${L.get("position_id","bsnh[3]")};
            ${M.setByOffset("i","re")}
            let im = ${E.getByOffset("i")} * ${L.get("position_id","bsnh[3]")} +
                ${E.getByOffset("j")} * ${B.get("position_id","bsnh[3]")};
            ${M.setByOffset("j","im")}
          } else {
            let k = dot(bsnh, uniforms.input_output_strides) + half_rotary_emb_dim;
            ${M.setByOffset("k",E.getByOffset("k"))}
          }
        }`};return{name:"RotaryEmbedding",shaderCache:{hint:Ze({interleaved:r}).cacheKey,inputDependencies:["rank","rank","rank","rank"]},getShaderSource:S,getRunData:()=>({outputs:[{dims:e[0].dims,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(V.size(w)/lr)},programUniforms:x})}},Cg=(e,t)=>{xc(e.inputs,t),e.compute(On(e.inputs,t))}}),Lv=de(()=>{"use strict";dt(),Oe(),da(),wg(),$g(),Li(),Ig(),Re(),$c=(e,t)=>{if(t.doRotary&&e.length<=7)throw new Error("cos_cache and sin_cache inputs are required if do_rotary is specified");let r=e[0],n=e[1],s=e[2],l=e[3],a=e[4];if(t.doRotary!==0&&e.length<=7)throw new Error("cos_cast and sin_cache are expected if do_rotary attribute is non-zero");if(t.localWindowSize!==-1)throw new Error("Local attention is not supported");if(t.softcap!==0)throw new Error("Softcap is not supported");if(t.rotaryInterleaved!==0)throw new Error("Rotary interleaved is not supported");if(t.smoothSoftmax)throw new Error("Smooth softmax is not supported");if(r.dims.length!==3&&r.dims.length!==5)throw new Error("Input query is expected to have 3 or 5 dimensions");let d=!1,p=r.dims[0],c=r.dims[1],g=r.dims.length===3?d?r.dims[2]/3:r.dims[2]:t.numHeads*r.dims[4],_=c,w=0,C=!n||n.dims.length===0,x=Math.floor(C?g/(t.numHeads+2*t.kvNumHeads):g/t.numHeads);C&&(g=x*t.numHeads);let S=l&&l.dims.length!==0,N=a&&a.dims.length!==0;if(S&&l.dims.length===4&&l.dims[0]===p&&l.dims[1]!==t.kvNumHeads&&l.dims[2]===t.kvNumHeads&&l.dims[3]===x)throw new Error("BSNH pastKey/pastValue is not supported");if(S&&N){if(l.dims.length!==4)throw new Error('Input "past_key" is expected to have 4 dimensions');if(a.dims.length!==4)throw new Error('Input "past_value" is expected to have 4 dimensions');w=l.dims[2]}else if(S||N)throw new Error('Input "past_key" and "past_value" shall be both present or both absent');let E=1;if(n&&n.dims.length>0){if(r.dims.length!==3)throw new Error('Input "query" is expected to have 3 dimensions when key is given');if(n.dims.length<3||n.dims.length>5)throw new Error('Input "key" is expected to have 3, 4, or 5 dimensions');if(r.dims[0]!==n.dims[0])throw new Error('Input "query" and "key" shall have same dim 0 (batch size)');if(n.dims.length===3){if(r.dims[2]%n.dims[2]!==0)throw new Error('Dimension 2 of "query" should be a multiple of "key"');_=n.dims[1]}else if(n.dims.length===5){if(n.dims[2]!==t.numHeads||n.dims[3]!==2||n.dims[4]!==x)throw new Error('Expect "key" shape (batch_size, kv_sequence_length, num_heads, 2, head_size) for packed kv');if(s)throw new Error('Expect "value" be none when "key" has packed kv format.');_=n.dims[1]}else{if(n.dims[1]!==t.numHeads||n.dims[3]!==x)throw new Error('Expect "key" shape (batch_size, num_heads, kv_sequence_length, head_size) for past_key');_=n.dims[2]}}else{if(r.dims.length!==3&&r.dims.length!==5)throw new Error('Input "query" is expected to have 3 or 5 dimensions when key is empty');if(r.dims.length===5&&(r.dims[2]!==t.numHeads||r.dims[3]!==3))throw new Error('Expect "query" shape (batch_size, kv_sequence_length, num_heads, 3, head_size) for packed kv');E=3}let T=0,B=!1,L=t.kvNumHeads?x*t.kvNumHeads:g;if(s&&s.dims.length>0){if(s.dims.length!==3&&s.dims.length!==4)throw new Error('Input "value" is expected to have 3 or 4 dimensions');if(r.dims[0]!==s.dims[0])throw new Error('Input "query" and "value" shall have same dim 0 (batch_size)');if(s.dims.length===3){if(_!==s.dims[1])throw new Error('Input "key" and "value" shall have the same dim 1 (kv_sequence_length)');L=s.dims[2]}else{if(_!==s.dims[2])throw new Error('Input "past_key" and "past_value" shall have the same dim 2 (kv_sequence_length)');L=s.dims[1]*s.dims[3],B=!0}}let M=e.length>4?e[5]:void 0;if(M){if(M.dims.length===0)throw new Error("seqlens_k must be at least 1D, got scalar.");let F=M.dims.reduce((U,k)=>U*k,1);if(F!==p)throw new Error(`seqlens_k must have batch_size (${p}) elements, got ${F}.`);for(let U=0;U<M.dims.length;U++)if(M.dims[U]!==1&&M.dims[U]!==p)throw new Error(`seqlens_k has unexpected shape. Each dimension must be 1 or batch_size (${p}), got dims[${U}] = ${M.dims[U]}.`)}return{batchSize:p,sequenceLength:c,pastSequenceLength:w,kvSequenceLength:_,totalSequenceLength:-1,maxSequenceLength:-1,inputHiddenSize:0,hiddenSize:g,vHiddenSize:L,headSize:x,vHeadSize:Math.floor(L/t.kvNumHeads),numHeads:t.numHeads,kvNumHeads:t.kvNumHeads,nReps:t.numHeads/t.kvNumHeads,pastPresentShareBuffer:!1,maskType:T,scale:t.scale,broadcastResPosBias:!1,passPastInKv:B,qkvFormat:E}},Cc=Ze({perm:[0,2,1,3]}),go=(e,t,r)=>{let n=t,s=r.kvNumHeads;return t.dims.length===3&&r.kvSequenceLength!==0&&(n=t.reshape([r.batchSize,r.kvSequenceLength,s,r.headSize]),n=e.compute(Rt(n,Cc.perm),{inputs:[n],outputs:[-1]})[0]),n},Ic=(e,t,r,n)=>{let s=7,l=["type","type"],a=[e*t],d=e*t,p=[{type:12,data:d},{type:12,data:t},{type:12,data:e}],c=g=>{let _=Z("seq_lens",r.dataType,r.dims),w=Z("total_seq_lens",n.dataType,n.dims),C=we("pos_ids",s,a),x=[{name:"output_size",type:"u32"},{name:"sequence_length",type:"u32"},{name:"batch_size",type:"u32"}];return`
  ${g.registerUniforms(x).declareVariables(_,w,C)}
  ${g.mainStart()}
    ${g.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let total_sequence_length = u32(${w.getByOffset("0")});
    let is_subsequent_prompt = uniforms.sequence_length > 1 && uniforms.sequence_length != total_sequence_length;
    let is_first_prompt = !is_subsequent_prompt && uniforms.sequence_length == total_sequence_length;
    let batch_idx = global_idx / uniforms.sequence_length;
    let sequence_idx = i32(global_idx % uniforms.sequence_length);
    var pos_id: i32 = 0;
    let seqlen = ${_.getByOffset("batch_idx")};
    let total_seqlen = seqlen + 1;
    if (is_first_prompt) {
      if (sequence_idx < total_seqlen) {
        pos_id = sequence_idx;
      } else {
        pos_id = 1;
      }
      ${C.setByOffset("global_idx","pos_id")}
    } else if (is_subsequent_prompt) {
      let past_seqlen = total_seqlen - i32(uniforms.sequence_length);
      if (past_seqlen + sequence_idx < total_seqlen) {
        pos_id = past_seqlen + sequence_idx;
      } else {
        pos_id = 1;
      }
      ${C.setByOffset("global_idx","pos_id")}
    } else if (global_idx < uniforms.batch_size) {
      ${C.setByOffset("global_idx","seqlen")}
    };
  }
  `};return{name:"GeneratePositionIds",shaderCache:{hint:`${e};${t}`,inputDependencies:l},getRunData:()=>({outputs:[{dims:a,dataType:s}],dispatchGroup:{x:Math.ceil(d/64)},programUniforms:p}),getShaderSource:c}},Tg=(e,t)=>{if(e.inputs.length>14&&e.inputs[14]||e.inputs.length>15&&e.inputs[15])throw new Error("GroupQueryAttention (JSEP): q_norm_weight / k_norm_weight inputs are not supported. The per-head Q/K RMS normalization prologue is implemented only on the CUDA and native WebGPU EPs.");let r=$c(e.inputs,t);if(e.inputs[0].dims.length===5)throw new Error("Packed QKV is not implemented");if(e.inputs[1]?.dims.length===5)throw new Error("Packed KV is not implemented");let n=e.inputs[0],s=e.inputs[1]&&e.inputs[1].dims.length>0?e.inputs[1]:void 0,l=e.inputs[2]&&e.inputs[2].dims.length>0?e.inputs[2]:void 0,a=e.inputs[3]&&e.inputs[3].dims.length!==0?e.inputs[3]:void 0,d=e.inputs[4]&&e.inputs[4].dims.length!==0?e.inputs[4]:void 0,p=e.inputs.length>4?e.inputs[5]:void 0,c=e.inputs.length>5?e.inputs[6]:void 0,g=r.kvNumHeads?r.kvNumHeads:r.numHeads,_=Ze({axis:2,numOutputs:3,splitSizes:[r.numHeads*r.headSize,g*r.headSize,g*r.headSize]}),[w,C,x]=!s&&!l?e.compute(Go([n],_),{inputs:[n],outputs:[-1,-1,-1]}):[n,s,l],S,N;if(t.doRotary){let L=e.compute(Ic(r.batchSize,r.sequenceLength,p,c),{inputs:[p,c],outputs:[-1]})[0],M=e.inputs[7],F=e.inputs[8],U=Ze({interleaved:t.rotaryInterleaved!==0,numHeads:r.numHeads,rotaryEmbeddingDim:0,scale:t.scale}),k=[w,L,M,F],re=[-1];S=e.compute(On(k,U),{inputs:k,outputs:re})[0],k.splice(0,1,C);let oe=Ze({interleaved:t.rotaryInterleaved!==0,numHeads:r.kvNumHeads,rotaryEmbeddingDim:0,scale:t.scale});N=e.compute(On(k,oe),{inputs:k,outputs:re})[0]}let E=kr(e,r.batchSize,r.numHeads,r.sequenceLength,r.headSize,t.doRotary?S:w,void 0,0),T=go(e,t.doRotary?N:C,r),B=go(e,x,r);Mr(e,E,T,B,void 0,void 0,a,d,void 0,r,p,c)}}),Mv=de(()=>{"use strict";Oe(),Me(),Li(),Re(),yo=(e,t,r,n,s,l,a,d)=>{let p=ut(l),c=p===1?"f32":`vec${p}f`,g=p===1?"vec2f":`mat2x${p}f`,_=s*a,w=64;_===1&&(w=256);let C=[s,a,l/p],x=[s,a,2],S=["rank","type","type"],N=[];N.push(...Pe(C,x));let E=T=>{let B=Z("x",t.dataType,3,p),L=Z("scale",r.dataType,r.dims),M=Z("bias",n.dataType,n.dims),F=we("output",1,3,2),U=[B,L,M,F];return`
  var<workgroup> workgroup_shared : array<${g}, ${w}>;
  const workgroup_size = ${w}u;
  ${T.declareVariables(...U)}
  ${T.mainStart(w)}
    let batch = workgroup_index / uniforms.x_shape[1];
    let channel = workgroup_index % uniforms.x_shape[1];
    let hight = uniforms.x_shape[2];
    // initialize workgroup memory
    var sum = ${c}(0);
    var squared_sum = ${c}(0);
    for (var h = local_idx; h < hight; h += workgroup_size) {
      let value = ${c}(${B.get("batch","channel","h")});
      sum += value;
      squared_sum += value * value;
    }
    workgroup_shared[local_idx] = ${g}(sum, squared_sum);
    workgroupBarrier();

    for (var currSize = workgroup_size >> 1;  currSize > 0; currSize = currSize >> 1) {
      if (local_idx < currSize) {
        workgroup_shared[local_idx] = workgroup_shared[local_idx] + workgroup_shared[local_idx + currSize];
      }
      workgroupBarrier();
    }
    if (local_idx == 0) {
      let sum_final = ${Bi("workgroup_shared[0][0]",p)} / f32(hight * ${p});
      let squared_sum_final = ${Bi("workgroup_shared[0][1]",p)} / f32(hight * ${p});

      let inv_std_dev = inverseSqrt(squared_sum_final - sum_final * sum_final + f32(${d}));
      let channel_scale = inv_std_dev * f32(scale[channel]);
      let channel_shift = f32(bias[channel]) - sum_final * channel_scale;
      output[workgroup_index] = vec2f(channel_scale, channel_shift);
    }
  }`};return e.compute({name:"InstanceNormComputeChannelScaleShift",shaderCache:{hint:`${p};${d};${w}`,inputDependencies:S},getRunData:()=>({outputs:[{dims:x,dataType:1}],dispatchGroup:{x:_},programUniforms:N}),getShaderSource:E},{inputs:[t,r,n],outputs:[-1]})[0]},Tc=(e,t,r)=>{let n=t[0].dims,s=n,l=2,a=n[0],d=n[1],p=V.sizeFromDimension(n,l),c=ut(p),g=V.size(s)/c,_=yo(e,t[0],t[1],t[2],a,p,d,r.epsilon),w=[a,d,p/c],C=[a,d],x=["type","none"],S=N=>{let E=Z("x",t[0].dataType,w.length,c),T=Z("scale_shift",1,C.length,2),B=we("output",t[0].dataType,w.length,c),L=[E,T,B];return`
  ${N.registerUniform("output_size","u32").declareVariables(...L)}
  ${N.mainStart()}
  ${N.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
      let outputIndices = ${B.offsetToIndices("global_idx")};
      let batch = outputIndices[0];
      let channel = outputIndices[1];
      let scale_shift = ${T.getByIndices("vec2<u32>(batch, channel)")};
      let value = ${E.getByOffset("global_idx")} * ${B.type.value}(scale_shift.x) + ${B.type.value}(scale_shift.y);
      ${B.setByOffset("global_idx","value")};
  }`};e.compute({name:"InstanceNormalization",shaderCache:{hint:`${c}`,inputDependencies:x},getRunData:()=>({outputs:[{dims:s,dataType:t[0].dataType}],dispatchGroup:{x:Math.ceil(g/64)},programUniforms:[{type:12,data:g},...Pe(w,C,w)]}),getShaderSource:S},{inputs:[t[0],_]})},Sc=(e,t,r)=>{let n=t[0].dims,s=n,l=n[0],a=n[n.length-1],d=V.sizeFromDimension(n,1)/a,p=ut(a),c=V.size(s)/p,g=[{type:12,data:d},{type:12,data:Math.floor(a/p)}],_=["type","type"],w=!1,C=[0,n.length-1];for(let E=0;E<n.length-2;E++)w=w||n[E+1]!==1,C.push(E+1);w=w&&n[n.length-1]!==1;let x=w?e.compute(Rt(e.inputs[0],C),{inputs:[e.inputs[0]],outputs:[-1]})[0]:e.inputs[0].reshape(Array.from({length:n.length},(E,T)=>n[C[T]])),S=yo(e,x,t[1],t[2],l,d,a,r.epsilon),N=E=>{let T=ht(t[0].dataType),B=p===1?"vec2f":`mat${p}x2f`,L=U=>{let k=U===0?"x":"y",re=p===1?"f32":`vec${p}f`;switch(p){case 1:return`${T}(${re}(scale.${k}))`;case 2:return`vec2<${T}>(${re}(scale[0].${k}, scale[1].${k}))`;case 4:return`vec4<${T}>(${re}(scale[0].${k}, scale[1].${k}, scale[2].${k}, scale[3].${k}))`;default:throw new Error(`Not supported compoents ${p}`)}},M=Z("input",t[0].dataType,t[0].dims,p),F=we("output",t[0].dataType,s,p);return`
  @group(0) @binding(0) var<storage, read> input : array<${M.type.storage}>;
  @group(0) @binding(1) var<storage, read> scale_input : array<${B}>;
  @group(0) @binding(2) var<storage, read_write> output : array<${F.type.storage}>;
  struct Uniforms {H: u32, C : u32};
  @group(0) @binding(3) var<uniform> uniforms: Uniforms;

  ${E.mainStart()}
    let current_image_number = global_idx / (uniforms.C * uniforms.H);
    let current_channel_number = global_idx % uniforms.C;

    let scale_offset = current_image_number * uniforms.C + current_channel_number;
    let scale = scale_input[scale_offset];
    output[global_idx] = fma(input[global_idx], ${L(0)}, ${L(1)});
  }`};e.compute({name:"InstanceNormalizationNHWC",shaderCache:{hint:`${p}`,inputDependencies:_},getRunData:()=>({outputs:[{dims:s,dataType:t[0].dataType}],dispatchGroup:{x:Math.ceil(c/64)},programUniforms:g}),getShaderSource:N},{inputs:[t[0],S]})},Sg=(e,t)=>{t.format==="NHWC"?Sc(e,e.inputs,t):Tc(e,e.inputs,t)}}),Rv=de(()=>{"use strict";Oe(),Me(),Re(),Pc=e=>{if(!e||e.length<2)throw new Error("layerNorm requires at least 2 inputs.")},Ec=(e,t,r)=>{let n=t.simplified,s=e[0].dims,l=e[1],a=!n&&e[2],d=s,p=V.normalizeAxis(t.axis,s.length),c=V.sizeToDimension(s,p),g=V.sizeFromDimension(s,p),_=V.size(l.dims),w=a?V.size(a.dims):0;if(_!==g||a&&w!==g)throw new Error(`Size of X.shape()[axis:] == ${g}.
       Size of scale and bias (if provided) must match this.
       Got scale size of ${_} and bias size of ${w}`);let C=[];for(let M=0;M<s.length;++M)M<p?C.push(s[M]):C.push(1);let x=ut(g),S=["type","type"],N=[{type:12,data:c},{type:1,data:g},{type:12,data:Math.floor(g/x)},{type:1,data:t.epsilon}];a&&S.push("type");let E=r>1,T=r>2,B=M=>{let F=ht(e[0].dataType),U=[Z("x",e[0].dataType,e[0].dims,x),Z("scale",l.dataType,l.dims,x)];a&&U.push(Z("bias",a.dataType,a.dims,x)),U.push(we("output",e[0].dataType,d,x)),E&&U.push(we("mean_data_output",1,C)),T&&U.push(we("inv_std_output",1,C));let k=[{name:"norm_count",type:"u32"},{name:"norm_size",type:"f32"},{name:"norm_size_vectorized",type:"u32"},{name:"epsilon",type:"f32"}];return`
  ${M.registerUniforms(k).declareVariables(...U)}
  ${M.mainStart()}
    ${M.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.norm_count")}
    let offset = global_idx * uniforms.norm_size_vectorized;
    var mean_vector = ${Ro("f32",x)};
    var mean_square_vector = ${Ro("f32",x)};

    for (var h: u32 = 0u; h < uniforms.norm_size_vectorized; h++) {
      let value = ${or(F,x,"x[h + offset]")};
      mean_vector += value;
      mean_square_vector += value * value;
    }
    let mean = ${Bi("mean_vector",x)} / uniforms.norm_size;
    let inv_std_dev = inverseSqrt(${Bi("mean_square_vector",x)} / uniforms.norm_size ${n?"":"- mean * mean"} + uniforms.epsilon);

    for (var j: u32 = 0; j < uniforms.norm_size_vectorized; j++) {
      let f32input = ${or(F,x,"x[j + offset]")};
      let f32scale = ${or(F,x,"scale[j]")};
      output[j + offset] = ${U[0].type.value}((f32input ${n?"":"- mean"}) * inv_std_dev * f32scale
        ${a?`+ ${or(F,x,"bias[j]")}`:""}
      );
    }

    ${E?"mean_data_output[global_idx] = mean":""};
    ${T?"inv_std_output[global_idx] = inv_std_dev":""};
  }`},L=[{dims:d,dataType:e[0].dataType}];return E&&L.push({dims:C,dataType:1}),T&&L.push({dims:C,dataType:1}),{name:"LayerNormalization",shaderCache:{hint:`${x};${r};${n}`,inputDependencies:S},getRunData:()=>({outputs:L,dispatchGroup:{x:Math.ceil(c/64)},programUniforms:N}),getShaderSource:B}},Pg=(e,t)=>{Pc(e.inputs),e.compute(Ec(e.inputs,t,e.outputCount))}}),Dv=de(()=>{"use strict";Me(),ma(),ga(),Ac=e=>{if(!e||e.length!==2)throw new Error("MatMul requires 2 inputs.");if(e[0].dims[e[0].dims.length-1]!==e[1].dims[e[1].dims.length-2])throw new Error("shared dimension does not match.")},Eg=e=>{Ac(e.inputs);let t=ar.calcShape(e.inputs[0].dims,e.inputs[1].dims,!0);if(!t)throw new Error("Can't use matmul on the given tensors");let r=t[t.length-1],n=e.inputs[0].dims[e.inputs[0].dims.length-1];if(r<8&&n<8)e.compute(ha(e.inputs,{activation:""},t));else{let s=t[t.length-2],l=V.size(e.inputs[0].dims.slice(0,-2)),a=V.size(e.inputs[1].dims.slice(0,-2));if(l!==1&&s===1&&a===1){let d=e.inputs[0].reshape([1,l,n]),p=e.inputs[1].reshape([1,n,r]),c=[1,l,r],g=[d,p];e.compute(An(g,{activation:""},t,c),{inputs:g})}else e.compute(An(e.inputs,{activation:""},t))}}}),zv=de(()=>{"use strict";Oe(),Me(),dt(),Re(),Oc=(e,t)=>{if(e.length<3||e.length>4)throw new Error("MatMulNBits requires 3 or 4 inputs");let r=e[0],n=r.dims.length;if(r.dims[n-1]!==t.k)throw new Error("The last dim of input shape does not match the k value");let s=Math.floor((t.k+t.blockSize-1)/t.blockSize),l=t.blockSize/8*t.bits,a=e[1];if(!V.areEqual(a.dims,[t.n,s,l]))throw new Error("The second inputs must be 3D tensor with shape N X nBlocksPerCol X blobSize");let d=e[2].dims;if(V.size(d)!==t.n*s)throw new Error("scales input size error.");if(e.length===4){let p=e[3].dims,c=t.n*(t.bits===8?s:Math.floor((s*t.bits+7)/8));if(V.size(p)!==c)throw new Error("zeroPoints input size error.")}},kc=(e,t)=>{let r=e[0].dims,n=r.length,s=r[n-2],l=t.k,a=t.n,d=r.slice(0,n-2),p=V.size(d),c=e[1].dims[2]/4,g=e[0].dataType,_=ut(t.k),w=ut(c),C=ut(a),x=d.concat([s,a]),S=s>1&&a/C%2===0?2:1,N=V.size(x)/C/S,E=64,T=[],B=[p,s,l/_],L=V.convertShape(e[1].dims).slice();L.splice(-1,1,c/w),T.push(...Pe(B)),T.push(...Pe(L)),T.push(...Pe(e[2].dims)),e.length===4&&T.push(...Pe(V.convertShape(e[3].dims)));let M=[p,s,a/C];T.push(...Pe(M));let F=U=>{let k=B.length,re=Z("a",e[0].dataType,k,_),oe=Z("b",12,L.length,w),ye=Z("scales",e[2].dataType,e[2].dims.length),fe=[re,oe,ye],ce=e.length===4?Z("zero_points",12,e[3].dims.length):void 0;ce&&fe.push(ce);let $e=M.length,q=we("output",e[0].dataType,$e,C),Y=ht(e[0].dataType),Ie=(()=>{switch(_){case 1:return`array<${Y}, 8>`;case 2:return`mat4x2<${Y}>`;case 4:return`mat2x4<${Y}>`;default:throw new Error(`${_}-component is not supported.`)}})(),Te=Math.floor(32/t.bits),be=Math.floor(Te/8),ke=()=>{let ve="";for(let me=0;me<be;me++){let Ue=me*t.bits*4,st=Ue+t.bits;ve+=`
          // reuse a data (pass ${me})
            var input_offset${me>0?me:""} = ${me===0?re.indicesToOffset(`${re.type.indices}(batch, row, word_offset)`):"input_offset"};
            var a_data${me>0?me:""}: ${Ie};
            for (var j${me>0?me:""}: u32 = 0; j${me>0?me:""} < ${8/_}; j${me>0?me:""}++) {
              a_data${me>0?me:""}[j${me>0?me:""}] = ${re.getByOffset(`input_offset${me>0?me:""}`)};
              input_offset${me>0?me:""}++;
            }
          `;for(let et=0;et<C*S;et++)ve+=`
            b_value = ${w===1?`b${et}_data`:`b${et}_data[i]`};
            ${t.bits===2?`{
              let half_word = b_value >> ${me*16}u;
              let byte_lo = half_word & 0xFFu;
              let byte_hi = (half_word >> 8u) & 0xFFu;
              let spread_word = (byte_lo & 0xFu) | ((byte_lo >> 4u) << 8u) | ((byte_hi & 0xFu) << 16u) | ((byte_hi >> 4u) << 24u);
              b_value_lower = unpack4xU8(spread_word & b_mask);
              b_value_upper = unpack4xU8((spread_word >> 2u) & b_mask);
            }`:`b_value_lower = unpack4xU8((b_value >> ${Ue}u) & b_mask);
            b_value_upper = unpack4xU8((b_value >> ${st}u) & b_mask);`}
            b_quantized_values = ${Ie}(${Array.from({length:4},(it,Ge)=>`${Y}(b_value_lower[${Ge}]), ${Y}(b_value_upper[${Ge}])`).join(", ")});
            b_dequantized_values = ${_===1?`${Ie}(${Array.from({length:8},(it,Ge)=>`(b_quantized_values[${Ge}] - ${ce?`zero_point${et}`:"zero_point"}) * scale${et}`).join(", ")});`:`(b_quantized_values - ${Ie}(${Array(8).fill(`${ce?`zero_point${et}`:"zero_point"}`).join(",")})) * scale${et};`};
            workgroup_shared[local_id.x * ${S} + ${Math.floor(et/C)}]${C>1?`[${et%C}]`:""} += ${Array.from({length:8/_},(it,Ge)=>`${_===1?`a_data${me>0?me:""}[${Ge}] * b_dequantized_values[${Ge}]`:`dot(a_data${me>0?me:""}[${Ge}], b_dequantized_values[${Ge}])`}`).join(" + ")};
          `}return ve},ne=()=>{let ve=`
            var col_index = col * ${C};
            ${ce?`
            let zero_point_values_per_byte: u32 = ${Math.floor(8/t.bits)}u;
            let zero_point_bytes_per_col = (nBlocksPerCol + zero_point_values_per_byte - 1u) / zero_point_values_per_byte;
            var zero_point_byte_count: u32;
            var zero_point_word_index: u32;
            var zero_point_byte_offset: u32;
            let zero_point_sub_offset: u32 = block % zero_point_values_per_byte;
            var zero_point_bits_offset: u32;
            var zero_point_word: u32;`:`
            // The default zero point is ${Math.pow(2,t.bits-1)} for unsigned ${t.bits}-bit quantization.
            let zero_point = ${Y}(${Math.pow(2,t.bits-1).toFixed(1)});`}
            `;for(let me=0;me<C*S;me++)ve+=`
            let scale${me} = ${ye.getByOffset("col_index * nBlocksPerCol + block")};
            ${ce?`
            zero_point_byte_count = col_index * zero_point_bytes_per_col + (block / zero_point_values_per_byte);
            zero_point_word_index = zero_point_byte_count >> 0x2u;
            zero_point_byte_offset = zero_point_byte_count & 0x3u;
            zero_point_bits_offset = (zero_point_byte_offset << 3) + (zero_point_sub_offset * ${t.bits}u);
            zero_point_word = ${ce.getByOffset("zero_point_word_index")} >> zero_point_bits_offset;
            let zero_point${me} = ${Y}((zero_point_word) & ${t.bits===2?"0x3u":"0xFu"});`:""}
            col_index += 1;`;return ve},Se=()=>{let ve=`col_index = col * ${C};`;for(let me=0;me<C*S;me++)ve+=`
            let b${me}_data = ${oe.getByIndices(`${oe.type.indices}(col_index, block, word)`)};
            col_index += 1;`;return ve+=`
            var b_value: u32;
            let b_mask: u32 = ${t.bits===2?"0x03030303u":"0x0F0F0F0Fu"};
            var b_value_lower: vec4<u32>;
            var b_value_upper: vec4<u32>;
            var b_quantized_values: ${Ie};
            var b_dequantized_values: ${Ie};`,ve};return`
        var<workgroup> workgroup_shared: array<${q.type.value}, ${S*E}>;
        ${U.declareVariables(...fe,q)}
        ${U.mainStart([E,1,1])}
          let output_indices = ${q.offsetToIndices(`(global_idx / ${E}) * ${S}`)};
          let col = output_indices[2];
          let row = output_indices[1];
          let batch = output_indices[0];
          let nBlocksPerCol = uniforms.b_shape[1];

          for (var block = local_id.x; block < nBlocksPerCol; block += ${E}) {
            //process one block
            var word_offset: u32 = block * ${t.blockSize/_};
            ${ne()}
            for (var word: u32 = 0; word < ${c}; word += ${w}) {
              ${Se()}
              for (var i: u32 = 0; i < ${w}; i++) {
                ${ke()}
                word_offset += ${Te/_};
              }
            }
          }
          workgroupBarrier();

          if (local_id.x < ${S}) {
            var output_value: ${q.type.value} = ${q.type.value}(0);
            var workgroup_shared_offset: u32 = local_id.x;
            for (var b: u32 = 0u; b < ${E}u; b++) {
              output_value += workgroup_shared[workgroup_shared_offset];
              workgroup_shared_offset += ${S};
            }
            ${q.setByIndices(`${q.type.indices}(batch, row, col + local_id.x)`,"output_value")};
          }
        }`};return{name:"MatMulNBits",shaderCache:{hint:`${t.blockSize};${t.bits};${_};${w};${C};${S};${E}`,inputDependencies:Array(e.length).fill("rank")},getRunData:()=>({outputs:[{dims:x,dataType:g}],dispatchGroup:{x:N},programUniforms:T}),getShaderSource:F}},Nc=(e,t)=>{let r=e[0].dims,n=r.length,s=r[n-2],l=t.k,a=t.n,d=r.slice(0,n-2),p=V.size(d),c=e[1].dims[2]/4,g=e[0].dataType,_=ut(t.k),w=ut(c),C=d.concat([s,a]),x=128,S=a%8===0?8:a%4===0?4:1,N=x/S,E=Math.floor(32/t.bits),T=N*w*E,B=T/_,L=T/t.blockSize,M=V.size(C)/S,F=[],U=[p,s,l/_],k=V.convertShape(e[1].dims).slice();k.splice(-1,1,c/w),F.push(...Pe(U)),F.push(...Pe(k)),F.push(...Pe(e[2].dims)),e.length===4&&F.push(...Pe(V.convertShape(e[3].dims)));let re=[p,s,a];F.push(...Pe(re));let oe=ye=>{let fe=U.length,ce=Z("a",e[0].dataType,fe,_),$e=Z("b",12,k.length,w),q=Z("scales",e[2].dataType,e[2].dims.length),Y=[ce,$e,q],Ie=e.length===4?Z("zero_points",12,e[3].dims.length):void 0;Ie&&Y.push(Ie);let Te=re.length,be=we("output",e[0].dataType,Te),ke=ht(e[0].dataType),ne=()=>{switch(_){case 1:return`
          let a_data0 = vec4<${ke}>(sub_a[word_offset], sub_a[word_offset + 1], sub_a[word_offset + 2], sub_a[word_offset + 3]);
          let a_data1 = vec4<${ke}>(sub_a[word_offset + 4], sub_a[word_offset + 5], sub_a[word_offset + 6], sub_a[word_offset + 7]);`;case 2:return`
          let a_data0 = vec4<${ke}>(sub_a[word_offset], sub_a[word_offset + 1]);
          let a_data1 = vec4<${ke}>(sub_a[word_offset + 2], sub_a[word_offset + 3]);`;case 4:return`
          let a_data0 = sub_a[word_offset];
          let a_data1 = sub_a[word_offset + 1];`;default:throw new Error(`${_}-component is not supported.`)}};return`
        var<workgroup> sub_a: array<${ce.type.value}, ${B}>;
        var<workgroup> inter_results: array<array<${be.type.value}, ${N}>, ${S}>;
        ${ye.declareVariables(...Y,be)}
        ${ye.mainStart([N,S,1])}
          let output_indices = ${be.offsetToIndices(`workgroup_index * ${S}`)};
          let col = output_indices[2];
          let row = output_indices[1];
          let batch = output_indices[0];
          let n_blocks_per_col = uniforms.b_shape[1];
          let num_tiles =  (n_blocks_per_col - 1) / ${L} + 1;

          // Loop over shared dimension.
          for (var tile: u32 = 0; tile < num_tiles; tile += 1) {
            let a_col_start = tile * ${B};
            // load one tile A data into shared memory.
            for (var a_offset = local_idx; a_offset < ${B}; a_offset += ${x})
            {
              let a_col = a_col_start + a_offset;
              if (a_col < uniforms.a_shape[2])
              {
                sub_a[a_offset] = ${ce.getByIndices(`${ce.type.indices}(batch, row, a_col)`)};
              } else {
                sub_a[a_offset] = ${ce.type.value}(0);
              }
            }
            workgroupBarrier();

            // each thread process one block
            let b_row = col + local_id.y;
            let block = tile * ${L} + local_id.x;
            ${Ie?`
            let zero_point_values_per_byte: u32 = ${Math.floor(8/t.bits)}u;
            let zero_point_bytes_per_col = (n_blocks_per_col + zero_point_values_per_byte - 1u) / zero_point_values_per_byte;
            let zero_point_byte_count = b_row * zero_point_bytes_per_col + (block / zero_point_values_per_byte);
            let zero_point_word_index = zero_point_byte_count >> 0x2u;
            let zero_point_byte_offset = zero_point_byte_count & 0x3u;
            let zero_point_sub_offset: u32 = block % zero_point_values_per_byte;
            let zero_point_bits_offset = (zero_point_byte_offset << 3) + (zero_point_sub_offset * ${t.bits}u);
            let zero_point_word = ${Ie.getByOffset("zero_point_word_index")} >> zero_point_bits_offset;
            let zero_point = ${ke}((zero_point_word) & ${t.bits===2?"0x3u":"0xFu"});`:`
            // The default zero point is ${Math.pow(2,t.bits-1)} for unsigned ${t.bits}-bit quantization.
            let zero_point = ${ke}(${Math.pow(2,t.bits-1).toFixed(1)});`}
            let scale = ${q.getByOffset("b_row * n_blocks_per_col + block")};
            let b_data = ${$e.getByIndices(`${$e.type.indices}(b_row, block, 0)`)};
            var word_offset = local_id.x * ${t.blockSize/_};
            for (var i: u32 = 0; i < ${w}; i++) {
              let b_value = ${w===1?"b_data":"b_data[i]"};
              ${(()=>{let Se=Math.floor(E/8),ve="";for(let me=0;me<Se;me++){let Ue=me*t.bits*4,st=Ue+t.bits;ve+=`
              ${ne()}
              {${t.bits===2?`
                let half_word = b_value >> ${me*16}u;
                let byte_lo = half_word & 0xFFu;
                let byte_hi = (half_word >> 8u) & 0xFFu;
                let spread_word = (byte_lo & 0xFu) | ((byte_lo >> 4u) << 8u) | ((byte_hi & 0xFu) << 16u) | ((byte_hi >> 4u) << 24u);
                let b_value_lower = unpack4xU8(spread_word & 0x03030303u);
                let b_value_upper = unpack4xU8((spread_word >> 2u) & 0x03030303u);`:`
                let b_value_lower = unpack4xU8((b_value >> ${Ue}u) & 0x0F0F0F0Fu);
                let b_value_upper = unpack4xU8((b_value >> ${st}u) & 0x0F0F0F0Fu);`}
                let b_quantized_values = mat2x4<${ke}>(${Array.from({length:4},(et,it)=>`${ke}(b_value_lower[${it}]), ${ke}(b_value_upper[${it}])`).join(", ")});
                let b_dequantized_values = (b_quantized_values - mat2x4<${ke}>(${Array(8).fill("zero_point").join(",")})) * scale;
                inter_results[local_id.y][local_id.x] += ${Array.from({length:2},(et,it)=>`${`dot(a_data${it}, b_dequantized_values[${it}])`}`).join(" + ")};
              }
              word_offset += ${8/_};`}return ve})()}
            }
            workgroupBarrier();
          }

          if (local_idx < ${S}) {
            var output_value: ${be.type.value} = ${be.type.value}(0);
            for (var b = 0u; b < ${N}; b++) {
              output_value += inter_results[local_idx][b];
            }
            if (col + local_idx < uniforms.output_shape[2])
            {
              ${be.setByIndices(`${be.type.indices}(batch, row, col + local_idx)`,"output_value")}
            }
          }
        }`};return{name:"BlockwiseMatMulNBits32",shaderCache:{hint:`${t.blockSize};${_};${w};${N};${S}`,inputDependencies:Array(e.length).fill("rank")},getRunData:()=>({outputs:[{dims:C,dataType:g}],dispatchGroup:{x:M},programUniforms:F}),getShaderSource:oe}},Ag=(e,t)=>{Oc(e.inputs,t),t.blockSize===32&&e.adapterInfo.isVendor("intel")&&e.adapterInfo.isArchitecture("gen-12lp")?e.compute(Nc(e.inputs,t)):e.compute(kc(e.inputs,t))},Og=e=>Ze(e)}),Fv=de(()=>{"use strict";Oe(),Me(),Re(),Bc=e=>{if(!e||e.length<1)throw new Error("Too few inputs");if(e[0].dataType!==1&&e[0].dataType!==10)throw new Error("Input type must be float or float16.");if(e.length>=2){let t=e[0].dims.length*2===e[1].dims[0];if(e.length===4&&(t=e[3].dims[0]*2===e[1].dims[0]),!t)throw new Error("The pads should be a 1D tensor of shape [2 * input_rank] or [2 * num_axes].")}},Lc=(e,t,r)=>{let n="";for(let s=t-1;s>=0;--s)n+=`
            k = i32(${e.indicesGet("indices",s)}) - ${Ce("uniforms.pads",s,r)};
            if (k < 0) {
              break;
            }
            if (k >= i32(${Ce("uniforms.x_shape",s,t)})) {
              break;
            }
            offset += k * i32(${Ce("uniforms.x_strides",s,t)});
        `;return`
          value = ${e.type.value}(uniforms.constant_value);
          for (var i = 0; i < 1; i++) {
            var offset = 0;
            var k = 0;
            ${n}
            value = x[offset];
          }
      `},Mc=(e,t,r)=>{let n="";for(let s=t-1;s>=0;--s)n+=`
                k = i32(${e.indicesGet("indices",s)}) - ${Ce("uniforms.pads",s,r)};
                if (k < 0) {
                  k = -k;
                }
                {
                  let _2n_1 = 2 * (i32(${Ce("uniforms.x_shape",s,t)}) - 1);
                  k = k % _2n_1;
                  if(k >= i32(${Ce("uniforms.x_shape",s,t)})) {
                    k = _2n_1 - k;
                  }
                }
                offset += k * i32(${Ce("uniforms.x_strides",s,t)});
            `;return`
              var offset = 0;
              var k = 0;
              ${n}
              value = x[offset];
          `},Rc=(e,t,r)=>{let n="";for(let s=t-1;s>=0;--s)n+=`
                k = i32(${e.indicesGet("indices",s)}) - ${Ce("uniforms.pads",s,r)};
                if (k < 0) {
                  k = 0;
                }
                if (k >= i32(${Ce("uniforms.x_shape",s,t)})) {
                  k = i32(${Ce("uniforms.x_shape",s,t)}) - 1;
                }
                offset += k * i32(${Ce("uniforms.x_strides",s,t)});
            `;return`
              var offset = 0;
              var k = 0;
              ${n}
              value = x[offset];
          `},Dc=(e,t,r)=>{let n="";for(let s=t-1;s>=0;--s)n+=`
                k = i32(${e.indicesGet("indices",s)}) - ${Ce("uniforms.pads",s,r)};
                if (k < 0)  {
                  k += i32(${Ce("uniforms.x_shape",s,t)}]);
                }
                if (k >= i32(${Ce("uniforms.x_shape",s,t)})) {
                  k -= i32(${Ce("uniforms.x_shape",s,t)});
                }
                offset += k * i32(${Ce("uniforms.x_strides",s,t)});
            `;return`
              var offset = 0;
              var k = 0;
              ${n}
              value = x[offset];
          `},zc=(e,t,r)=>{switch(r.mode){case 0:return Lc(e,t,r.pads.length);case 1:return Mc(e,t,r.pads.length);case 2:return Rc(e,t,r.pads.length);case 3:return Dc(e,t,r.pads.length);default:throw new Error("Invalid mode")}},Fc=(e,t)=>{let r=V.padShape(e[0].dims.slice(),t.pads),n=e[0].dims,s=V.size(r),l=[{type:12,data:s},{type:6,data:t.pads}],a=e.length>=3&&e[2].data;t.mode===0&&l.push({type:a?e[2].dataType:1,data:t.value}),l.push(...Pe(e[0].dims,r));let d=["rank"],p=c=>{let g=we("output",e[0].dataType,r.length),_=Z("x",e[0].dataType,n.length),w=_.type.value,C=zc(g,n.length,t),x=[{name:"output_size",type:"u32"},{name:"pads",type:"i32",length:t.pads.length}];return t.mode===0&&x.push({name:"constant_value",type:a?w:"f32"}),`
            ${c.registerUniforms(x).declareVariables(_,g)}
            ${c.mainStart()}
            ${c.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

            let indices = ${g.offsetToIndices("global_idx")};

            var value = ${w}(0);
            ${C}
            output[global_idx] = value;
        }`};return{name:"Pad",shaderCache:{hint:`${t.mode}${a}`,inputDependencies:d},getRunData:()=>({outputs:[{dims:r,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(V.size(r)/64)},programUniforms:l}),getShaderSource:p}},Uc=(e,t)=>{if(e.length>1){let r=e[1].getBigInt64Array(),n=e.length>=3&&e[2].data?e[2].dataType===10?e[2].getUint16Array()[0]:e[2].getFloat32Array()[0]:0,s=e[0].dims.length,l=new Int32Array(2*s).fill(0);if(e.length>=4){let d=e[3].getBigInt64Array();for(let p=0;p<d.length;p++)l[Number(d[p])]=Number(r[p]),l[Number(d[p])+s]=Number(r[p+d.length])}else r.forEach((d,p)=>l[Number(p)]=Number(d));let a=[];return l.forEach(d=>a.push(d)),{mode:t.mode,value:n,pads:a}}else return t},kg=(e,t)=>{Bc(e.inputs);let r=Uc(e.inputs,t);e.compute(Fc(e.inputs,r),{inputs:[0]})}}),Uv=de(()=>{"use strict";Wt(),Oe(),Me(),Re(),Tr=e=>{if(lt.webgpu.validateInputContent&&(!e||e.length!==1))throw new Error("Pool ops requires 1 input.")},_o=(e,t,r)=>{let n=t.format==="NHWC",s=e.dims.slice();n&&s.splice(1,0,s.pop());let l=Object.hasOwnProperty.call(t,"dilations"),a=t.kernelShape.slice(),d=t.strides.slice(),p=l?t.dilations.slice():[],c=t.pads.slice();Pn.adjustPoolAttributes(r,s,a,d,p,c);let g=Pn.computePoolOutputShape(r,s,d,p,a,c,t.autoPad,t.ceilMode),_=Object.assign({},t);l?Object.assign(_,{kernelShape:a,strides:d,pads:c,dilations:p,cacheKey:t.cacheKey}):Object.assign(_,{kernelShape:a,strides:d,pads:c,cacheKey:t.cacheKey});let w=g.slice();return w.push(w.splice(1,1)[0]),[_,n?w:g]},vo=(e,t)=>{let r=t.format==="NHWC",n=V.size(e),s=V.size(t.kernelShape),l=[{type:12,data:n},{type:12,data:s}],a=[{name:"outputSize",type:"u32"},{name:"kernelSize",type:"u32"}];if(t.kernelShape.length<=2){let d=t.kernelShape[t.kernelShape.length-1],p=t.strides[t.strides.length-1],c=t.pads[t.pads.length/2-1],g=t.pads[t.pads.length-1],_=!!(c+g);l.push({type:12,data:d},{type:12,data:p},{type:12,data:c},{type:12,data:g}),a.push({name:"kw",type:"u32"},{name:"sw",type:"u32"},{name:"pwStart",type:"u32"},{name:"pwEnd",type:"u32"});let w=!1;if(t.kernelShape.length===2){let C=t.kernelShape[t.kernelShape.length-2],x=t.strides[t.strides.length-2],S=t.pads[t.pads.length/2-2],N=t.pads[t.pads.length-2];w=!!(S+N),l.push({type:12,data:C},{type:12,data:x},{type:12,data:S},{type:12,data:N}),a.push({name:"kh",type:"u32"},{name:"sh",type:"u32"},{name:"phStart",type:"u32"},{name:"phEnd",type:"u32"})}return[l,a,!0,_,w]}else{if(r)throw new Error("Pooling with kernelShape.length > 2 is not supported for NHWC format.");let d=V.computeStrides(t.kernelShape);l.push({type:12,data:d},{type:12,data:t.pads},{type:12,data:t.strides}),a.push({name:"kernelStrides",type:"u32",length:d.length},{name:"pads",type:"u32",length:t.pads.length},{name:"strides",type:"u32",length:t.strides.length});let p=t.pads.reduce((c,g)=>c+g);return[l,a,!!p,!1,!1]}},wo=(e,t,r,n,s,l,a,d,p,c,g,_)=>{let w=s.format==="NHWC",C=t.type.value,x=we("output",t.type.tensor,n);if(s.kernelShape.length<=2){let S="",N="",E="",T=r-(w?2:1);if(g?S=`
                for (var i: u32 = 0u; i < uniforms.kw; i++) {
                  xIndices[${T}] = indices[${T}] * uniforms.sw - uniforms.pwStart + i;
                  if (xIndices[${T}] < 0 || xIndices[${T}]
                      >= uniforms.x_shape[${T}]) {
                    pad++;
                    continue;
                  }
                  let x_val = x[${t.indicesToOffset("xIndices")}];
                  ${l}
                }`:S=`
                for (var i: u32 = 0u; i < uniforms.kw; i++) {
                  xIndices[${T}] = indices[${T}] * uniforms.sw - uniforms.pwStart + i;
                  let x_val = x[${t.indicesToOffset("xIndices")}];
                  ${l}
                }`,s.kernelShape.length===2){let B=r-(w?3:2);_?N=`
                for (var j: u32 = 0u; j < uniforms.kh; j++) {
                  xIndices[${B}] = indices[${B}] * uniforms.sh - uniforms.phStart + j;
                  if (xIndices[${B}] < 0 || xIndices[${B}] >= uniforms.x_shape[${B}]) {
                    pad += i32(uniforms.kw);
                    continue;
                  }
              `:N=`
                for (var j: u32 = 0u; j < uniforms.kh; j++) {
                  xIndices[${B}] = indices[${B}] * uniforms.sh - uniforms.phStart + j;
                `,E=`
              }
            `}return`
            ${e.registerUniforms(p).declareVariables(t,x)}

            ${e.mainStart()}
              ${e.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}

              let indices = ${x.offsetToIndices("global_idx")};
              var xIndices = ${x.offsetToIndices("global_idx")};

              var value = ${C}(${d});
              var pad = 0;
              ${N}
              ${S}
              ${E}
              ${a}

              output[global_idx] = value;
            }`}else{if(w)throw new Error("Pooling with kernelShape.length > 2 is not supported for NHWC format.");let S=s.kernelShape.length,N=s.pads.length,E="";return c?E=`
                if (xIndices[j] >= uniforms.x_shape[j]) {
                  pad++;
                  isPad = true;
                  break;
                }
              }
              if (!isPad) {
                let x_val = x[${t.indicesToOffset("xIndices")}];
                ${l}
              }`:E=`
              }
              let x_val = x[${t.indicesToOffset("xIndices")}];
              ${l}
            `,`
            ${e.registerUniforms(p).declareVariables(t,x)}

            ${e.mainStart()}
              ${e.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
              let indices = ${x.offsetToIndices("global_idx")};
              var xIndices = ${x.offsetToIndices("global_idx")};

              var offsets: array<u32, ${S}>;

              var value = ${C}(${d});
              var pad = 0;
              var isPad = false;

              for (var i: u32 = 0u; i < uniforms.kernelSize; i++) {
                var offset = i;
                for (var j = 0u; j < ${S-1}u; j++) {
                  offsets[j] = offset / ${Ce("uniforms.kernelStrides","j",S)};
                  offset -= offsets[j] * ${Ce("uniforms.kernelStrides","j",S)};
                }
                offsets[${S-1}] = offset;

                isPad = false;
                for (var j = ${r-S}u; j < ${r}u; j++) {
                  xIndices[j] = indices[j] * ${Ce("uniforms.strides",`j - ${r-S}u`,S)}
                    + offsets[j - ${r-S}u] - ${Ce("uniforms.pads","j - 2u",N)};
                  ${E}
              }
              ${a}

              output[global_idx] = value;
            }`}},bo=e=>`${e.format};${e.ceilMode};${e.autoPad};${e.kernelShape.length}`,qc=e=>`${bo(e)};${e.countIncludePad}`,Wc=e=>`${bo(e)};${e.storageOrder};${e.dilations}`,xo=e=>({format:e.format,autoPad:["NOTSET","VALID","SAME_UPPER","SAME_LOWER"][e.auto_pad],ceilMode:e.ceil_mode,kernelShape:e.kernel_shape,strides:e.strides,pads:e.pads}),$o=(e,t,r,n)=>{let[s,l]=_o(t,n,r),a=Z("x",t.dataType,t.dims.length),d=a.type.value,p="value += x_val;",c="";s.countIncludePad?c+=`value /= ${d}(uniforms.kernelSize);`:c+=`value /= ${d}(i32(uniforms.kernelSize) - pad);`;let[g,_,w,C,x]=vo(l,s);g.push(...Pe(t.dims,l));let S=["rank"];return{name:e,shaderCache:{hint:`${n.cacheKey};${w};${C};${x}`,inputDependencies:S},getRunData:()=>({outputs:[{dims:l,dataType:t.dataType}],dispatchGroup:{x:Math.ceil(V.size(l)/64)},programUniforms:g}),getShaderSource:N=>wo(N,a,t.dims.length,l.length,s,p,c,0,_,w,C,x)}},Ng=e=>{let t=e.count_include_pad!==0,r=xo(e);if(r.ceilMode!==0)throw new Error("ceil_mode output-shape is computed, but ceil_mode kernel execution (padding/divisor) is not yet implemented in the WebGPU AveragePool kernel");let n={countIncludePad:t,...r,cacheKey:""};return{...n,cacheKey:qc(n)}},Bg=(e,t)=>{Tr(e.inputs),e.compute($o("AveragePool",e.inputs[0],!1,t))},Co={autoPad:"",ceilMode:0,countIncludePad:!1,kernelShape:[],strides:[],pads:[],storageOrder:0,dilations:[]},Lg=e=>{let t=e.format;return{format:t,...Co,cacheKey:t}},Mg=(e,t)=>{Tr(e.inputs),e.compute($o("GlobalAveragePool",e.inputs[0],!0,t))},Io=(e,t,r,n)=>{let[s,l]=_o(t,n,r),a=`
      value = max(x_val, value);
    `,d="",p=Z("x",t.dataType,t.dims.length),c=["rank"],[g,_,w,C,x]=vo(l,s);return g.push(...Pe(t.dims,l)),{name:e,shaderCache:{hint:`${n.cacheKey};${w};${C};${x}`,inputDependencies:c},getRunData:()=>({outputs:[{dims:l,dataType:t.dataType}],dispatchGroup:{x:Math.ceil(V.size(l)/64)},programUniforms:g}),getShaderSource:S=>wo(S,p,t.dims.length,l.length,s,a,d,t.dataType===10?-65504:-1e5,_,w,C,x)}},Rg=(e,t)=>{Tr(e.inputs),e.compute(Io("MaxPool",e.inputs[0],!1,t))},Dg=e=>{let t=e.storage_order,r=e.dilations,n=xo(e);if(t!==0)throw new Error("column major storage order is not yet supported for MaxPool");if(n.ceilMode!==0)throw new Error("ceil_mode output-shape is computed, but ceil_mode kernel execution (padding) is not yet implemented in the WebGPU MaxPool kernel");let s={storageOrder:t,dilations:r,...n,cacheKey:""};return{...s,cacheKey:Wc(s)}},zg=e=>{let t=e.format;return{format:t,...Co,cacheKey:t}},Fg=(e,t)=>{Tr(e.inputs),e.compute(Io("GlobalMaxPool",e.inputs[0],!0,t))}}),qv=de(()=>{"use strict";Oe(),Me(),dt(),Re(),Xc=(e,t)=>{if(e.length<2||e.length>3)throw new Error("DequantizeLinear requires 2 or 3 inputs.");if(e.length===3&&e[1].dims===e[2].dims)throw new Error("x-scale and x-zero-point must have the same shape.");if(e.length===3&&e[0].dataType!==e[2].dataType)throw new Error("x and x-zero-point must have the same data type.");if(e[1].dims.length!==0&&e[1].dims.length!==1&&e[1].dims.length!==e[0].dims.length)throw new Error("scale input must be a scalar, a 1D tensor, or have the same rank as the input tensor.");if(e.length>2){if(e[0].dataType!==e[2].dataType)throw new Error("x and x-zero-point must have the same data type.");if(e[1].dims.length!==e[2].dims.length)throw new Error("scale and zero-point inputs must have the same rank.");if(!e[1].dims.map((r,n)=>r===e[2].dims[n]).reduce((r,n)=>r&&n,!0))throw new Error("scale and zero-point inputs must have the same shape.")}if(t.blockSize>0){if(e[1].dims.length===0||e[1].dims.length===1&&e[1].dims[0]===1)throw new Error("blockSize must be set only for block quantization.");if(!e[1].dims.map((s,l)=>l===t.axis||s===e[0].dims[l]).reduce((s,l)=>s&&l,!0))throw new Error("For block qunatization, scale input shape to match the input shape except for the axis");if(e[1].dims.length!==e[0].dims.length)throw new Error("For block qunatization the scale input rank must be the same as the x rank.");let r=e[0].dims[t.axis],n=e[1].dims[t.axis];if(t.blockSize<Math.ceil(r/n)||t.blockSize>Math.ceil(r/(n-1)-1))throw new Error("blockSize must be with in the range [ceil(dI / Si), ceil(dI / (Si - 1) - 1)].")}},Yc=(e,t)=>{let r=V.normalizeAxis(t.axis,e[0].dims.length),n=e[0].dataType,s=n===3,l=e[0].dims,a=e[1].dataType,d=V.size(l),p=n===3||n===2,c=p?[Math.ceil(V.size(e[0].dims)/4)]:e[0].dims,g=e[1].dims,_=e.length>2?e[2]:void 0,w=_?p?[Math.ceil(V.size(_.dims)/4)]:_.dims:void 0,C=g.length===0||g.length===1&&g[0]===1,x=C===!1&&g.length===1,S=ut(d),N=C&&(!p||S===4),E=N?S:1,T=N&&!p?S:1,B=Z("input",p?12:n,c.length,T),L=Z("scale",a,g.length),M=_?Z("zero_point",p?12:n,w.length):void 0,F=we("output",a,l.length,E),U=[B,L];M&&U.push(M);let k=[c,g];_&&k.push(w);let re=[{type:12,data:d/E},{type:12,data:r},{type:12,data:t.blockSize},...Pe(...k,l)],oe=ye=>{let fe=[{name:"output_size",type:"u32"},{name:"axis",type:"u32"},{name:"block_size",type:"u32"}];return`
      ${ye.registerUniforms(fe).declareVariables(...U,F)}
      ${ye.mainStart()}
          ${ye.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
          let output_indices = ${F.offsetToIndices("global_idx")};

          // Set input x
          ${p?`
            let input = ${B.getByOffset("global_idx / 4")};
            let x_vec = ${s?"unpack4xI8(input)":"unpack4xU8(input)"};
            let x_value = ${E===1?"x_vec[global_idx % 4]":"x_vec"};`:`let x_value = ${B.getByOffset("global_idx")};`};

          // Set scale input
          ${C?`let scale_value= ${L.getByOffset("0")}`:x?`
            let scale_index = ${F.indicesGet("output_indices","uniforms.axis")};
            let scale_value= ${L.getByOffset("scale_index")};`:`
            var scale_indices: ${L.type.indices} = output_indices;
            let index = ${L.indicesGet("scale_indices","uniforms.axis")} / uniforms.block_size;
            ${L.indicesSet("scale_indices","uniforms.axis","index")};
            let scale_value= ${L.getByIndices("scale_indices")};`};

          // Set zero-point input
          ${M?C?p?`
                let zero_point_input = ${M.getByOffset("0")};
                let zero_point_vec =  ${s?"unpack4xI8(zero_point_input)":"unpack4xU8(zero_point_input)"};
                let zero_point_value= zero_point_vec[0]`:`let zero_point_value = ${M.getByOffset("0")}`:x?p?`
                let zero_point_index = ${F.indicesGet("output_indices","uniforms.axis")};
                let zero_point_input = ${M.getByOffset("zero_point_index / 4")};
                let zero_point_vec =  ${s?"unpack4xI8(zero_point_input)":"unpack4xU8(zero_point_input)"};
                let zero_point_value = zero_point_vec[zero_point_index % 4]`:`
                let zero_point_index = ${F.indicesGet("output_indices","uniforms.axis")};
                let zero_point_value = ${M.getByOffset("zero_point_index")};`:p?`
                let zero_point_offset = ${L.indicesToOffset("scale_indices")};
                let zero_point_input = ${M.getByOffset("zero_point_offset / 4")};
                let zero_point_vec = ${s?"unpack4xI8(zero_point_input)":"unpack4xU8(zero_point_input)"};
                let zero_point_value = zero_point_vec[zero_point_offset % 4];`:`let zero_point_value = ${M.getByIndices("scale_indices")};`:`let zero_point_value = ${p?s?"i32":"u32":B.type.value}(0);`};
      // Compute and write output
      ${F.setByOffset("global_idx",`${F.type.value}(x_value - zero_point_value) * scale_value`)};
      }`};return{name:"DequantizeLinear",shaderCache:{hint:t.cacheKey,inputDependencies:M?["rank","rank","rank"]:["rank","rank"]},getShaderSource:oe,getRunData:()=>({outputs:[{dims:l,dataType:a}],dispatchGroup:{x:Math.ceil(d/E/64),y:1,z:1},programUniforms:re})}},Ug=(e,t)=>{Xc(e.inputs,t),e.compute(Yc(e.inputs,t))},qg=e=>Ze({axis:e.axis,blockSize:e.blockSize})}),Wv=de(()=>{"use strict";Wt(),Oe(),Re(),Gc=(e,t,r)=>{let n=e===t,s=e<t&&r<0,l=e>t&&r>0;if(n||s||l)throw new Error("Range these inputs' contents are invalid.")},Hc=(e,t,r,n)=>{let s=Math.abs(Math.ceil((t-e)/r)),l=[s],a=s,d=[{type:12,data:a},{type:n,data:e},{type:n,data:r},...Pe(l)],p=c=>{let g=we("output",n,l.length),_=g.type.value,w=[{name:"outputSize",type:"u32"},{name:"start",type:_},{name:"delta",type:_}];return`
        ${c.registerUniforms(w).declareVariables(g)}
        ${c.mainStart()}
        ${c.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
        output[global_idx] = uniforms.start + ${_}(global_idx) * uniforms.delta;
      }`};return{name:"Range",shaderCache:{hint:`${n}`},getShaderSource:p,getRunData:()=>({outputs:[{dims:l,dataType:n}],dispatchGroup:{x:Math.ceil(a/64)},programUniforms:d})}},Wg=e=>{let t=0,r=0,n=0;e.inputs[0].dataType===6?(t=e.inputs[0].getInt32Array()[0],r=e.inputs[1].getInt32Array()[0],n=e.inputs[2].getInt32Array()[0]):e.inputs[0].dataType===1&&(t=e.inputs[0].getFloat32Array()[0],r=e.inputs[1].getFloat32Array()[0],n=e.inputs[2].getFloat32Array()[0]),lt.webgpu.validateInputContent&&Gc(t,r,n),e.compute(Hc(t,r,n,e.inputs[0].dataType),{inputs:[]})}}),Xv=de(()=>{"use strict";Oe(),Me(),dt(),Re(),Vc=(e,t,r,n)=>{if(e!=="none"&&n!=="i32"&&n!=="u32"&&n!=="f32")throw new Error(`Input ${n} is not supported with reduction ${e}.`);let s=`{
                var oldValue = 0;
                loop {
                  let newValueF32 =`,l=`;
                  let newValue = bitcast<i32>(newValueF32);
                  let res = atomicCompareExchangeWeak(&${t}, oldValue, newValue);
                  if res.exchanged {
                    break;
                  }
                  oldValue = res.old_value;
                }
              }`;switch(e){case"none":return`${t}=${r};`;case"add":return n==="i32"||n==="u32"?`atomicAdd(&${t}, bitcast<${n}>(${r}));`:`
              ${s}bitcast<${n}>(oldValue) + (${r})${l}`;case"max":return n==="i32"||n==="u32"?`atomicMax(&${t}, bitcast<${n}>(${r}));`:`
                ${s}max(bitcast<f32>(oldValue), (${r}))${l}`;case"min":return n==="i32"||n==="u32"?`atomicMin(&${t}, bitcast<${n}>(${r}));`:`${s}min(bitcast<${n}>(oldValue), (${r}))${l}`;case"mul":return`${s}(bitcast<${n}>(oldValue) * (${r}))${l}`;default:throw new Error(`Reduction ${e} is not supported.`)}},jc=(e,t)=>{let r=e[0].dims,n=e[1].dims,s=r,l=1,a=Math.ceil(V.sizeToDimension(n,n.length-1)/l),d=n[n.length-1],p=V.sizeFromDimension(r,d),c=[{type:12,data:a},{type:12,data:d},{type:12,data:p},...Pe(e[1].dims,e[2].dims,s)],g=_=>{let w=Z("indices",e[1].dataType,e[1].dims.length),C=Z("updates",e[2].dataType,e[2].dims.length,l),x=t.reduction!=="none"&&t.reduction!==""?gh("output",e[0].dataType,s.length):we("output",e[0].dataType,s.length,l);return`
      ${_.registerUniform("output_size","u32").registerUniform("last_index_dimension","u32").registerUniform("num_updates_elements","u32").declareVariables(w,C,x)}
      ${_.mainStart()}
        ${_.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
  var data_offset = 0u;
  let indices_start = uniforms.last_index_dimension * global_idx;
  let indices_end = indices_start + uniforms.last_index_dimension;
  for (var i = indices_start; i < indices_end; i++) {
    var index = i32(indices[i].x);
    ${e[0].dims.length===1?`
    let element_count_dim = uniforms.output_strides;
    let dim_value = uniforms.output_shape;`:`
    let element_count_dim = uniforms.output_strides[i - indices_start];
    let dim_value = uniforms.output_shape[i - indices_start];`}
    if (index >= 0) {
      if (index >= i32(dim_value)) {
        index = i32(dim_value - 1);
      }
    } else {
      if (index < -i32(dim_value)) {
        index = 0;
      } else {
        index += i32(dim_value);
      }
    }
    data_offset += u32((u32(index) * element_count_dim));
  }

  for (var i = 0u; i < uniforms.num_updates_elements; i++) {
    let value = updates[uniforms.num_updates_elements * global_idx + i];
    ${Vc(t.reduction,"output[data_offset + i]","value",x.type.value)}
  }

      }`};return{name:"ScatterND",shaderCache:{hint:`${t.cacheKey}_${t.reduction}`,inputDependencies:["rank","rank"]},getRunData:()=>({outputs:[{dims:s,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(a/64)},programUniforms:c}),getShaderSource:g}},Xg=e=>Ze({reduction:e.reduction}),Yg=(e,t)=>{e.compute(jc(e.inputs,t),{inputs:[e.inputs[1],e.inputs[2]],outputs:[]})}}),Yv=de(()=>{"use strict";Oe(),Me(),dt(),Re(),Kc=(e,t)=>{if(e.every(r=>r>0||(()=>{throw new Error("Resize requires scales input values to be positive")})),e.length>0){if(t.mode==="linear"){if(!(e.length===2||e.length===3||e.length===4&&e[0]===1&&e[1]===1||e.length===4&&e[0]===1&&e[3]===1||e.length===5&&e[0]===1&&e[1]===1))throw new Error(`For linear mode, Resize requires scales to be 2D, 3D, 4D with either two outermost or one innermost and
            one outermost scale values equal to 1, or 5D with two outermost scale values equal to 1`)}else if(t.mode==="cubic"&&!(e.length===2||e.length===4&&e[0]===1&&e[1]===1||e.length===4&&e[0]===1&&e[3]===1))throw new Error("Resize requires scales input size to be 2 or 4 for cubic mode")}},Zc=(e,t,r)=>{t.every(s=>s>=0&&s<r||(()=>{throw new Error("Resize requires axes input values to be positive and less than rank")}));let n=new Array(r).fill(1);return t.forEach((s,l)=>n[s]=e[l]),n},Jc=(e,t,r,n,s,l)=>{let[a,d,p]=r>10?[1,2,3]:[-1,e.length>1?1:-1,-1],c=e[0].dims.length;if(a>0&&e.length>a&&e[a].dims.length>0)e[a].getFloat32Array().forEach(g=>l.push(g));else if(t.coordinateTransformMode==="tf_crop_and_resize")throw new Error("Resize requires RoI input to be specified when coordinateTransformMode is tfCropAndResize");if(d>0&&e.length>d&&e[d].dims.length===1&&e[d].dims[0]>0){if(e[d].getFloat32Array().forEach(g=>n.push(g)),n.length!==0&&n.length!==c&&r>=18&&n.length!==t.axes.length)throw new Error("Resize requires scales input size to be same as input rank or axes size for opset 18 and up");Kc(n,t),t.axes.length>0&&Zc(n,t.axes,c).forEach((g,_)=>n[_]=g)}if(p>0&&e.length>p&&e[p].dims.length===1&&e[p].dims[0]>0&&(e[p].getBigInt64Array().forEach(g=>s.push(Number(g))),s.length!==0&&s.length!==c&&r>=18&&s.length!==t.axes.length))throw new Error("Resize requires sizes input size to be same as input rank or axes size for opset 18 and up");if(t.axes.length>0){if(n.length!==0&&n.length!==t.axes.length)throw new Error('Resize requires "scales" input size to be of axes rank when axes attributes is specified');if(s.length!==0&&s.length!==t.axes.length)throw new Error('Resize requires "sizes" input size to be of rank axes rank when axes attributes is specified')}if(typeof n<"u"&&typeof s<"u"&&n.length>0&&s.length>c)throw new Error("Resize requires only of scales or sizes to be specified")},To=(e,t,r,n)=>`
  // The whole part and the fractional part are calculated separately due to inaccuracy of floating
  // point division. As an example, f32(21) / f32(7) may evaluate to 2.99... instead of 3, causing an
  // offset-by-one error later in floor().
  let big = (${e}) * (${t});
  let whole = ${n}(big / (${r}));
  let fract = ${n}(big % (${r})) / ${n}(${r});
  return whole + fract;
`,Qc=(e,t)=>`fn getOriginalCoordinateFromResizedCoordinate(xResized: u32, xScale: f32, lengthResized: u32,
     lengthOriginal: u32, roiStart: f32, roiEnd: f32) -> ${t} { `+(()=>{switch(e){case"asymmetric":return`
          if (xScale < 1.0 || floor(xScale) != xScale) {
            return ${t}(xResized) / ${t}(xScale);
          } else {
            ${To("xResized","lengthOriginal","lengthResized",t)}
          }
        `;case"pytorch_half_pixel":return`if (lengthResized > 1) {
                    return (${t}(xResized) + 0.5) / ${t}(xScale) - 0.5;
                  } else {
                    return 0.0;
                  }`;case"tf_half_pixel_for_nn":return`return (${t}(xResized) + 0.5) / ${t}(xScale);`;case"align_corners":return`if (lengthResized == 1) {
                    return 0.0;
                  } else {
                    ${To("xResized","lengthOriginal - 1","lengthResized - 1",t)}
                  }`;case"tf_crop_and_resize":return`if (lengthResized > 1) {
                    return ${t}(roiStart) * ${t}(lengthOriginal - 1) +
                        (${t}(xResized) * ${t}(roiEnd - roiStart) * ${t}(lengthOriginal - 1)) /
                        ${t}(lengthResized - 1);
                  } else {
                    return 0.5 * ${t}(roiStart + roiEnd) * ${t}(lengthOriginal - 1);
                  }`;case"half_pixel_symmetric":return`const outputWidth = ${t}xScale * ${t}(lengthResized);
                  const adjustment = ${t}(lengthResized) / outputWidth;
                  const center = ${t}(lengthOriginal) / 2;
                  const offset = center * (1 - adjustment);
                  return offset + ((${t}(xResized) + 0.5) / ${t}(xScale)) - 0.5;`;case"half_pixel":return`return ((${t}(xResized) + 0.5) / ${t}(xScale)) - 0.5;`;default:throw new Error(`Coordinate transform mode ${e} is not supported`)}})()+"}",ef=(e,t,r)=>`fn getNearestPixelFromOriginal(xOriginal: ${r}, isDownSample: bool) -> ${r} {`+(()=>{switch(e){case"round_prefer_ceil":return"if (fract(xOriginal) == 0.5) {             return ceil(xOriginal);           } else {             return round(xOriginal);           }";case"floor":return"return floor(xOriginal);";case"ceil":return"return ceil(xOriginal);";case"round_prefer_floor":return"if (fract(xOriginal) == 0.5) {                     return floor(xOriginal);                   } else {                     return round(xOriginal);                   }";default:if(t<11)return"if (isDownSample)                     {                       return ceil(xOriginal);                     } else {                       return xOriginal;                     }";throw new Error(`Nearest mode ${e} is not supported`)}})()+"}",tf=(e,t,r)=>{let n=new Array(r).fill(0).concat(new Array(r).fill(1)),s=e.length===0?n:e.slice();return t.length>0?(t.forEach((l,a)=>{n[l]=s[a],n[a+r]=s[t.length+a]}),n):s},rf=(e,t,r,n)=>{let s=[];if(r.length>0)if(n.length>0){if(e.forEach(l=>s.push(l)),Math.max(...n)>e.length)throw new Error("axes is out of bound");n.forEach((l,a)=>s[l]=r[a])}else r.forEach(l=>s.push(l));else{if(t.length===0)throw new Error("Resize requires either scales or sizes.");s=e.map((l,a)=>Math.round(l*t[a]))}return s},nf=(e,t,r)=>{let n=(()=>{switch(r.keepAspectRatioPolicy){case"not_larger":return r.axes.length>0?Math.min(...r.axes.map(l=>t[l]),Number.MAX_VALUE):Math.min(...t,Number.MAX_VALUE);case"not_smaller":return r.axes.length>0?Math.max(...r.axes.map(l=>t[l]),Number.MIN_VALUE):Math.max(...t,Number.MIN_VALUE);default:throw new Error(`Keep aspect ratio policy ${r.keepAspectRatioPolicy} is not supported`)}})();t.fill(1,0,t.length);let s=e.slice();return r.axes.length>0?(r.axes.forEach(l=>t[l]=n),r.axes.forEach(l=>s[l]=Math.round(e[l]*t[l]))):(t.fill(n,0,t.length),s.forEach((l,a)=>s[a]=Math.round(l*t[a]))),s},sf=(e,t,r,n,s)=>`
    fn calculateOriginalIndicesFromOutputIndices(output_indices: ${e.type.indices}) -> array<${e.type.value}, ${r.length}> {
      var original_indices: array<${e.type.value}, ${r.length}>;
      for (var i:u32 = 0; i < ${r.length}; i++) {
        var output_index = ${e.indicesGet("output_indices","i")};
        var scale = ${Ce("uniforms.scales","i",n)};
        var roi_low = ${Ce("uniforms.roi","i",s)};
        var roi_hi = ${Ce("uniforms.roi",`i + ${t.length}`,s)};
        if (scale == 1.0) {
          original_indices[i] = ${e.type.value}(output_index);
        } else {
          var input_shape_i = ${Ce("uniforms.input_shape","i",t.length)};
          var output_shape_i = ${Ce("uniforms.output_shape","i",r.length)};
          original_indices[i] = getOriginalCoordinateFromResizedCoordinate(output_index, scale, output_shape_i,
                                                                           input_shape_i, roi_low, roi_hi);
        }
      }
      return original_indices;
    }`,of=(e,t,r,n,s,l,a)=>`
    fn calculateInputIndicesFromOutputIndices(output_indices: ${t.type.indices}) -> ${e.type.indices} {
      var input_indices: ${e.type.indices};
      for (var i:u32 = 0; i < ${n.length}; i++) {
        var output_index = ${t.indicesGet("output_indices","i")};
        var input_index: u32;
        var scale = ${Ce("uniforms.scales","i",s)};
        if (scale == 1.0) {
          input_index = output_index;
        } else {
          var roi_low = ${Ce("uniforms.roi","i",l)};
          var roi_hi = ${Ce("uniforms.roi",`i + ${r.length}`,l)};
          var input_shape_i = ${Ce("uniforms.input_shape","i",r.length)};
          var output_shape_i = ${Ce("uniforms.output_shape","i",n.length)};
          var original_idx = getOriginalCoordinateFromResizedCoordinate(output_index, scale, output_shape_i,
                                                                        input_shape_i, roi_low, roi_hi);
          if (!${a} || (original_idx >= 0 && original_idx < ${t.type.value}(input_shape_i))) {
            if (original_idx < 0) {
              input_index = 0;
            } else if (original_idx > ${t.type.value}(input_shape_i - 1)) {
              input_index = input_shape_i - 1;
            } else {
              input_index = u32(getNearestPixelFromOriginal(original_idx, scale < 1));
            }
          } else {
            input_index = u32(original_idx);
          }
        }
        ${e.indicesSet("input_indices","i","input_index")}
      }
      return input_indices;
    }`,af=(e,t)=>`
    fn checkInputIndices(input_indices: ${e.type.indices}) -> bool {
      for (var i:u32 = 0; i < ${t.length}; i++) {
        var input_index = ${e.indicesGet("input_indices","i")};
        if (input_index < 0 || input_index >= ${Ce("uniforms.input_shape","i",t.length)}) {
          return false;
        }
      }
      return true;
    }`,So=(e,t,r,n)=>e.rank>n?`
    ${e.indicesSet("input_indices",t,"channel")};
    ${e.indicesSet("input_indices",r,"batch")};
`:"",lf=(e,t,r,n,s)=>{let[l,a,d,p]=r.length===2?[-1,0,1,-1]:[0,2,3,1],c=e.type.value;return`
    fn getInputValue(batch: u32, channel: u32, row: u32, col: u32) -> ${c} {
      var input_indices: ${e.type.indices};
      ${e.indicesSet("input_indices",a,`max(0, min(row, ${r[a]} - 1))`)};
      ${e.indicesSet("input_indices",d,`max(0, min(col, ${r[d]} - 1))`)};
      ${So(e,p,l,2)}
      return ${e.getByIndices("input_indices")};
    }

    fn bilinearInterpolation(output_indices: ${t.type.indices}) -> ${c} {
      var originalIndices = calculateOriginalIndicesFromOutputIndices(output_indices);
      var row:${c} = originalIndices[${a}];
      var col:${c} = originalIndices[${d}];
      ${n?`if (row < 0 || row > (${r[a]} - 1) || col < 0 || col > (${r[d]} - 1)) {
        return ${s};
      }`:""};
      row = max(0, min(row, ${r[a]} - 1));
      col = max(0, min(col, ${r[d]} - 1));
      var row1: u32 = u32(row);
      var col1: u32 = u32(col);
      var row2: u32 = u32(row + 1);
      var col2: u32 = u32(col + 1);
      var channel: u32 = ${r.length>2?`u32(originalIndices[${p}])`:"0"};
      var batch: u32 =  ${r.length>2?`u32(originalIndices[${l}])`:"0"};
      var x11: ${c} = getInputValue(batch, channel, row1, col1);
      var x12: ${c} = getInputValue(batch, channel, row1, col2);
      var x21: ${c} = getInputValue(batch, channel, row2, col1);
      var x22: ${c} = getInputValue(batch, channel, row2, col2);
      var dx1: ${c} = abs(row - ${c}(row1));
      var dx2: ${c} = abs(${c}(row2) - row);
      var dy1: ${c} = abs(col - ${c}(col1));
      var dy2: ${c} = abs(${c}(col2) - col);
      if (row1 == row2) {
        dx1 = 0.5;
        dx2 = 0.5;
      }
      if (col1 == col2) {
        dy1 = 0.5;
        dy2 = 0.5;
      }
      return (x11 * dx2 * dy2 + x12 * dx2 * dy1 + x21 * dx1 * dy2 + x22 * dx1 * dy1);
    }`},uf=(e,t,r,n,s,l,a,d,p,c)=>{let g=r.length===2,_=!0,[w,C]=g?[0,1]:_?[2,3]:[1,2],x=e.type.value,S=N=>{let E=N===w?"row":"col";return`
      fn ${E}CubicInterpolation(input_indices: ${e.type.indices}, output_indices: ${t.type.indices}) -> ${x} {
        var output_index = ${t.indicesGet("output_indices",N)};
        var originalIdx: ${x} = getOriginalCoordinateFromResizedCoordinate(output_index, ${s[N]},
        ${n[N]}, ${r[N]}, ${l[N]}, ${l[N]} + ${r.length});
        var fractOriginalIdx: ${x} = originalIdx - floor(originalIdx);
        var coefs = getCubicInterpolationCoefs(fractOriginalIdx);

        if (${d} && (originalIdx < 0 || originalIdx > (${r[N]} - 1))) {
          return ${p};
        }
        var data: array<${x}, 4> = array<${x}, 4>(0.0, 0.0, 0.0, 0.0);
        for (var i: i32 = -1; i < 3; i++) {
          var ${E}: ${x} = originalIdx + ${x}(i);
          if (${E} < 0 || ${E} >= ${r[N]}) {
            ${c?`coefs[i + 1] = 0.0;
                        continue;`:d?`return ${p};`:`${E} = max(0, min(${E}, ${r[N]} - 1));`};
          }
        var input_indices_copy: ${e.type.indices} = input_indices;
          ${e.indicesSet("input_indices_copy",N,`u32(${E})`)};
          data[i + 1] = ${N===w?e.getByIndices("input_indices_copy"):"rowCubicInterpolation(input_indices_copy, output_indices)"};
        }
        return cubicInterpolation1D(data, coefs);
      }`};return`
    ${S(w)};
    ${S(C)};
  fn getCubicInterpolationCoefs(s: ${x}) -> array<${x}, 4> {
    var absS = abs(s);
    var coeffs: array<${x}, 4> = array<${x}, 4>(0.0, 0.0, 0.0, 0.0);
    var oneMinusAbsS: ${x} = 1.0 - absS;
    var twoMinusAbsS: ${x} = 2.0 - absS;
    var onePlusAbsS: ${x} = 1.0 + absS;
    coeffs[0] = ((${a} * onePlusAbsS - 5 * ${a}) * onePlusAbsS + 8 * ${a}) * onePlusAbsS - 4 * ${a};
    coeffs[1] = ((${a} + 2) * absS - (${a} + 3)) * absS * absS + 1;
    coeffs[2] = ((${a} + 2) * oneMinusAbsS - (${a} + 3)) * oneMinusAbsS * oneMinusAbsS + 1;
    coeffs[3] = ((${a} * twoMinusAbsS - 5 * ${a}) * twoMinusAbsS + 8 * ${a}) * twoMinusAbsS - 4 * ${a};
    return coeffs;
  }

  fn cubicInterpolation1D(x: array<${x}, 4>, coefs: array<${x}, 4>) -> ${x} {
    var coefsSum: ${x} = coefs[0] + coefs[1] + coefs[2] + coefs[3];
    return (x[0] * coefs[0] + x[1] * coefs[1]+ x[2] * coefs[2]+ x[3] * coefs[3]) / coefsSum;
  }

  fn bicubicInterpolation(output_indices: ${t.type.indices}) -> ${x} {
    var input_indices: ${e.type.indices} = output_indices;
    return colCubicInterpolation(input_indices, output_indices);
  }
    `},df=(e,t,r,n,s)=>{let[l,a,d,p,c]=r.length===3?[-1,0,1,2,-1]:[0,2,3,4,1],g=e.type.value;return`
    fn getInputValue(batch: u32, channel: u32, depth:u32, height: u32, width: u32) -> ${g} {
      var input_indices: ${e.type.indices};
      ${e.indicesSet("input_indices",a,`max(0, min(depth, ${r[a]} - 1))`)};
      ${e.indicesSet("input_indices",d,`max(0, min(height, ${r[d]} - 1))`)};
      ${e.indicesSet("input_indices",p,`max(0, min(width, ${r[p]} - 1))`)};
      ${So(e,c,l,3)}
      return ${e.getByIndices("input_indices")};
    }

    fn trilinearInterpolation(output_indices: ${t.type.indices}) -> ${g} {
      var originalIndices = calculateOriginalIndicesFromOutputIndices(output_indices);
      var depth:${g} = originalIndices[${a}];
      var height:${g} = originalIndices[${d}];
      var width:${g} = originalIndices[${p}];
      ${n?`if (depth < 0 || depth > (${r[a]} - 1) || height < 0 || height > (${r[d]} - 1) || width < 0 || (width > ${r[p]} - 1)) {
      return ${s};
        }`:""};

    depth = max(0, min(depth, ${r[a]} - 1));
      height = max(0, min(height, ${r[d]} - 1));
      width = max(0, min(width, ${r[p]} - 1));
      var depth1: u32 = u32(depth);
      var height1: u32 = u32(height);
      var width1: u32 = u32(width);
      var depth2: u32 = u32(depth + 1);
      var height2: u32 = u32(height + 1);
      var width2: u32 = u32(width + 1);
      var channel: u32 = ${r.length>3?`u32(originalIndices[${c}])`:"0"};
      var batch: u32 =  ${r.length>3?`u32(originalIndices[${l}])`:"0"};

      var x111: ${g} = getInputValue(batch, channel, depth1, height1, width1);
      var x112: ${g} = getInputValue(batch, channel, depth1, height1, width2);
      var x121: ${g} = getInputValue(batch, channel, depth1, height2, width1);
      var x122: ${g} = getInputValue(batch, channel, depth1, height2, width2);
      var x211: ${g} = getInputValue(batch, channel, depth2, height1, width1);
      var x212: ${g} = getInputValue(batch, channel, depth2, height1, width2);
      var x221: ${g} = getInputValue(batch, channel, depth2, height2, width1);
      var x222: ${g} = getInputValue(batch, channel, depth2, height2, width2);
      var dx1: ${g} = abs(depth - ${g}(depth1));
      var dx2: ${g} = abs(${g}(depth2) - depth);
      var dy1: ${g} = abs(height - ${g}(height1));
      var dy2: ${g} = abs(${g}(height2) - height);
      var dz1: ${g} = abs(width - ${g}(width1));
      var dz2: ${g} = abs(${g}(width2) - width);
      if (depth1 == depth2) {
        dx1 = 0.5;
        dx2 = 0.5;
      }
      if (height1 == height2) {
        dy1 = 0.5;
        dy2 = 0.5;
      }
      if (width1 == width2) {
        dz1 = 0.5;
        dz2 = 0.5;
      }
      return (x111 * dx2 * dy2 * dz2 + x112 * dx2 * dy2 * dz1 + x121 * dx2 * dy1 *dz2 + x122 * dx2 * dy1 * dz1 +
              x211 * dx1 * dy2 * dz2 + x212 * dx1 * dy2 * dz1 + x221 * dx1 * dy1 *dz2 + x222 * dx1 * dy1 * dz1);
    }`},pf=(e,t,r,n,s,l)=>{let a=e.dims,d=tf(l,t.axes,a.length),p=rf(a,n,s,t.axes),c=n.slice();n.length===0&&(c=a.map((T,B)=>T===0?1:p[B]/T),t.keepAspectRatioPolicy!=="stretch"&&(p=nf(a,c,t)));let g=we("output",e.dataType,p.length),_=Z("input",e.dataType,a.length),w=V.size(p),C=a.length===p.length&&a.every((T,B)=>T===p[B]),x=t.coordinateTransformMode==="tf_crop_and_resize",S=t.extrapolationValue,N=_.type.value,E=T=>`
      ${C?"":`
      ${Qc(t.coordinateTransformMode,N)};
      ${(()=>{switch(t.mode){case"nearest":return`
              ${af(_,a)};
              ${ef(t.nearestMode,r,N)};
              ${of(_,g,a,p,c.length,d.length,x)};
              `;case"linear":return`
              ${sf(g,a,p,c.length,d.length)};
              ${(()=>{if(a.length===2||a.length===4)return`${lf(_,g,a,x,S)}`;if(a.length===3||a.length===5)return`${df(_,g,a,x,S)}`;throw Error("Linear mode only supports input dims 2, 3, 4 and 5 are supported in linear mode.")})()};
            `;case"cubic":return`
            ${(()=>{if(a.length===2||a.length===4)return`${uf(_,g,a,p,c,d,t.cubicCoeffA,x,t.extrapolationValue,t.excludeOutside)}`;throw Error("Cubic mode only supports input dims 2 and 4 are supported in linear mode.")})()};
            `;default:throw Error("Invalid resize mode")}})()};
      `}
      ${T.registerUniform("output_size","u32").registerUniform("scales","f32",c.length).registerUniform("roi","f32",d.length).declareVariables(_,g)}
      ${T.mainStart()}
        ${T.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
        ${C?"output[global_idx] = input[global_idx];":`
        let output_indices = ${g.offsetToIndices("global_idx")};
        var input_indices: ${_.type.indices};
        ${(()=>{switch(t.mode){case"nearest":return`input_indices = calculateInputIndicesFromOutputIndices(output_indices);
                if (checkInputIndices(input_indices)) {
                  output[global_idx] = ${_.getByIndices("input_indices")};
                } else {
                  output[global_idx] = ${t.extrapolationValue};
                }`;case"linear":return`output[global_idx] = ${a.length===2||a.length===4?"bilinearInterpolation":"trilinearInterpolation"}(output_indices);`;case"cubic":return"output[global_idx] = bicubicInterpolation(output_indices);";default:throw Error(`Unsupported resize mode: ${t.mode}`)}})()};
`}
      }`;return{name:"Resize",shaderCache:{hint:`${t.cacheKey}|${r}|${c.length>0?t.mode==="cubic"?c:c.length:""}|${s.length>0?s:""}|${d.length>0?d:""}|${C}|${t.mode==="nearest"?a.length:a}`,inputDependencies:["rank"]},getShaderSource:E,getRunData:()=>({outputs:[{dims:p,dataType:e.dataType}],dispatchGroup:{x:Math.ceil(w/64)},programUniforms:[{type:12,data:w},{type:1,data:c},{type:1,data:d},...Pe(a,p)]})}},cf=e=>{let t=e.customDataBuffer;return new Uint32Array(t.buffer,t.byteOffset,1)[0]},Gg=(e,t)=>{let r=[],n=[],s=[],l=cf(e);if(t.antialias!==0)throw Error("Only default value (0) for Antialias attribute is supported");Jc(e.inputs,t,l,r,n,s),e.compute(pf(e.inputs[0],t,l,r,n,s),{inputs:[0]})},Hg=e=>{let t=e.antialias,r=e.axes,n=e.coordinateTransformMode,s=e.cubicCoeffA,l=e.excludeOutside!==0,a=e.extrapolationValue,d=e.keepAspectRatioPolicy,p=e.mode,c=e.nearestMode===""?"simple":e.nearestMode;return Ze({antialias:t,axes:r,coordinateTransformMode:n,cubicCoeffA:s,excludeOutside:l,extrapolationValue:a,keepAspectRatioPolicy:d,mode:p,nearestMode:c})}}),Gv=de(()=>{"use strict";Oe(),Me(),Re(),ff=e=>{if(!e||e.length<3)throw new Error("layerNorm requires at least 3 inputs.");let t=e[0],r=e[1],n=e[2];if(t.dataType!==r.dataType||t.dataType!==n.dataType)throw new Error("All inputs must have the same data type");if(t.dims.length!==3&&t.dims.length!==2)throw new Error("Input must be 2D or 3D");if(r.dims.length!==3&&r.dims.length!==2)throw new Error("Skip must be 2D or 3D");let s=t.dims[t.dims.length-1],l=t.dims[t.dims.length-2];if(r.dims[r.dims.length-1]!==s)throw new Error("Skip must have the same hidden size as input");if(r.dims[r.dims.length-2]!==l)throw new Error("Skip must have the same sequence length as input");if(n.dims.length!==1)throw new Error("Gamma must be 1D");if(n.dims[n.dims.length-1]!==s)throw new Error("Gamma must have the same hidden size as input");if(e.length>3){let a=e[3];if(a.dims.length!==1)throw new Error("Beta must be 1D");if(a.dims[a.dims.length-1]!==s)throw new Error("Beta must have the same hidden size as input")}if(e.length>4){let a=e[4];if(a.dims.length!==1)throw new Error("Bias must be 1D");if(a.dims[a.dims.length-1]!==s)throw new Error("Bias must have the same hidden size as input")}},hf=(e,t,r,n)=>{let s=t.simplified,l=e[0].dims,a=V.size(l),d=l,p=a,c=l.slice(-1)[0],g=n?l.slice(0,-1).concat(1):[],_=!s&&e.length>3,w=e.length>4,C=n&&r>1,x=n&&r>2,S=r>3,N=64,E=ut(c),T=[{type:12,data:p},{type:12,data:E},{type:12,data:c},{type:1,data:t.epsilon}],B=M=>{let F=[{name:"output_size",type:"u32"},{name:"components",type:"u32"},{name:"hidden_size",type:"u32"},{name:"epsilon",type:"f32"}],U=[Z("x",e[0].dataType,e[0].dims,E),Z("skip",e[1].dataType,e[1].dims,E),Z("gamma",e[2].dataType,e[2].dims,E)];_&&U.push(Z("beta",e[3].dataType,e[3].dims,E)),w&&U.push(Z("bias",e[4].dataType,e[4].dims,E)),U.push(we("output",e[0].dataType,d,E)),C&&U.push(we("mean_output",1,g)),x&&U.push(we("inv_std_output",1,g)),S&&U.push(we("input_skip_bias_sum",e[0].dataType,d,E));let k=ht(e[0].dataType),re=ht(1,E);return`

      ${M.registerUniforms(F).declareVariables(...U)}
      var<workgroup> sum_shared : array<${re}, ${N}>;
      var<workgroup> sum_squared_shared : array<${re}, ${N}>;

      ${M.mainStart([N,1,1])}
        let ix = local_id.x;
        let iy = global_id.x / ${N};

        let hidden_size_vectorized: u32 = uniforms.hidden_size / uniforms.components;
        var stride = hidden_size_vectorized / ${N};
        let offset = ix * stride + iy * hidden_size_vectorized;
        let offset1d = stride * ix;
        if (ix == ${N-1}) {
          stride = hidden_size_vectorized - stride * ix;
        }
        for (var i: u32 = 0; i < stride; i++) {
          let skip_value = skip[offset + i];
          let bias_value = ${w?"bias[offset1d + i]":k+"(0.0)"};
          let input_value = x[offset + i];
          let value = input_value + skip_value + bias_value;
          ${S?"input_skip_bias_sum[offset + i] = value;":""}
          output[offset + i] = value;
          let f32_value = ${or(k,E,"value")};
          sum_shared[ix] += f32_value;
          sum_squared_shared[ix] += f32_value * f32_value;
        }
        workgroupBarrier();

        var reduce_size : u32 = ${N};
        for (var curr_size = reduce_size >> 1;  curr_size > 0; curr_size = reduce_size >> 1) {
          reduce_size = curr_size + (reduce_size & 1);
          if (ix < curr_size) {
            sum_shared[ix] += sum_shared[ix + reduce_size];
            sum_squared_shared[ix] += sum_squared_shared[ix + reduce_size];
          }
          workgroupBarrier();
        }

        let sum = sum_shared[0];
        let square_sum = sum_squared_shared[0];
        let mean = ${Bi("sum",E)} / f32(uniforms.hidden_size);
        let inv_std_dev = inverseSqrt(${Bi("square_sum",E)} / f32(uniforms.hidden_size) ${s?"":"- mean * mean"} + uniforms.epsilon);
        ${C?"mean_output[global_idx] = mean;":""}
        ${x?"inv_std_output[global_idx] = inv_std_dev;":""}

        for (var i: u32 = 0; i < stride; i++) {
          output[offset + i] = (output[offset + i] ${s?"":`- ${k}(mean)`}) *
            ${k}(inv_std_dev) * gamma[offset1d + i]
            ${_?"+ beta[offset1d + i]":""};
        }
      }`},L=[{dims:d,dataType:e[0].dataType}];return r>1&&L.push({dims:g,dataType:1}),r>2&&L.push({dims:g,dataType:1}),r>3&&L.push({dims:l,dataType:e[0].dataType}),{name:"SkipLayerNormalization",shaderCache:{hint:`${E};${C};${x};${S}`,inputDependencies:e.map((M,F)=>"type")},getShaderSource:B,getRunData:()=>({outputs:L,dispatchGroup:{x:Math.ceil(p/c)},programUniforms:T})}},Vg=(e,t)=>{ff(e.inputs);let r=[0];e.outputCount>1&&r.push(-3),e.outputCount>2&&r.push(-3),e.outputCount>3&&r.push(3),e.compute(hf(e.inputs,t,e.outputCount,!1),{outputs:r})}}),Hv=de(()=>{"use strict";Oe(),Me(),dt(),Re(),mf=(e,t)=>{if(!e||e.length<1)throw new Error("too few inputs");if(t.axes.length!==0){if(t.axes.length!==t.starts.length||t.axes.length!==t.ends.length)throw new Error("axes, starts and ends must have the same length")}else if(t.starts.length!==t.ends.length)throw new Error("starts and ends must have the same length");e.slice(1).forEach((r,n)=>{if(e[n+1].dataType!==6&&e[n+1].dataType!==7)throw new Error(`Input ${n} must be an array of int32 or int64`)})},Sr=(e,t)=>{let r=[];if(e.length>t)if(e[t].dataType===7)e[t].getBigInt64Array().forEach(n=>r.push(Number(n)));else if(e[t].dataType===6)e[t].getInt32Array().forEach(n=>r.push(Number(n)));else throw new Error(`Input ${t} must be an array of int32 or int64`);return r},gf=(e,t)=>{if(e.length>1){let r=Sr(e,1),n=Sr(e,2),s=Sr(e,3);return s.length===0&&(s=[...Array(e[0].dims.length).keys()]),Ze({starts:r,ends:n,axes:s})}else return t},Po=(e,t,r,n,s)=>{let l=e;return e<0&&(l+=r[n[t]]),s[t]<0?Math.max(0,Math.min(l,r[n[t]]-1)):Math.max(0,Math.min(l,r[n[t]]))},yf=(e,t,r)=>`fn calculateInputIndices(output_indices: ${t.type.indices}) -> ${e.type.indices} {
          var input_indices: ${e.type.indices};
          var carry = 0u;
          for (var i = ${r.length-1}; i >= 0; i--) {
            let input_shape_i = ${Ce("uniforms.input_shape","i",r.length)};
            let steps_i = ${Ce("uniforms.steps","i",r.length)};
            let signs_i = ${Ce("uniforms.signs","i",r.length)};
            let starts_i = ${Ce("uniforms.starts","i",r.length)};
            var output_index = ${t.indicesGet("output_indices","i")};
            var input_index = output_index * steps_i + starts_i + carry;
            carry = input_index / input_shape_i;
            input_index = input_index % input_shape_i;
            if (signs_i < 0) {
              input_index = input_shape_i - input_index - 1u + starts_i;
            }
            ${e.indicesSet("input_indices","i","input_index")};
          }
          return input_indices;
      }`,_f=(e,t)=>{let r=e[0].dims,n=V.size(r),s=t.axes.length>0?V.normalizeAxes(t.axes,r.length):[...Array(r.length).keys()],l=Sr(e,4);l.forEach(E=>E!==0||(()=>{throw new Error("step cannot be 0")})),l.length===0&&(l=Array(s.length).fill(1));let a=t.starts.map((E,T)=>Po(E,T,r,s,l)),d=t.ends.map((E,T)=>Po(E,T,r,s,l));if(s.length!==a.length||s.length!==d.length)throw new Error("start, ends and axes should have the same number of elements");if(s.length!==r.length)for(let E=0;E<r.length;++E)s.includes(E)||(a.splice(E,0,0),d.splice(E,0,r[E]),l.splice(E,0,1));let p=l.map(E=>Math.sign(E));l.forEach((E,T,B)=>{if(E<0){let L=(d[T]-a[T])/E,M=a[T],F=M+L*l[T];a[T]=F,d[T]=M,B[T]=-E}});let c=r.slice(0);s.forEach((E,T)=>{c[E]=Math.ceil((d[E]-a[E])/l[E])});let g={dims:c,dataType:e[0].dataType},_=we("output",e[0].dataType,c.length),w=Z("input",e[0].dataType,e[0].dims.length),C=V.size(c),x=[{name:"outputSize",type:"u32"},{name:"starts",type:"u32",length:a.length},{name:"signs",type:"i32",length:p.length},{name:"steps",type:"u32",length:l.length}],S=[{type:12,data:C},{type:12,data:a},{type:6,data:p},{type:12,data:l},...Pe(e[0].dims,c)],N=E=>`
      ${E.registerUniforms(x).declareVariables(w,_)}
        ${yf(w,_,r)}
        ${E.mainStart()}
          ${E.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
          let output_indices = ${_.offsetToIndices("global_idx")};
          let input_indices = calculateInputIndices(output_indices);
          ${_.setByOffset("global_idx",w.getByIndices("input_indices"))}
      }`;return{name:"Slice",shaderCache:{hint:`${p.length}_${a.length}_${l.length}`,inputDependencies:["rank"]},getShaderSource:N,getRunData:()=>({outputs:[g],dispatchGroup:{x:Math.ceil(n/64)},programUniforms:S})}},jg=(e,t)=>{mf(e.inputs,t);let r=gf(e.inputs,t);e.compute(_f(e.inputs,r),{inputs:[0]})},Kg=e=>{let t=e.starts,r=e.ends,n=e.axes;return Ze({starts:t,ends:r,axes:n})}}),Vv=de(()=>{"use strict";Oe(),Me(),dt(),Li(),Re(),vf=e=>{if(!e||e.length!==1)throw new Error("Softmax op requires 1 input.")},wf=(e,t)=>{let r=e.inputs[0],n=r.dims,s=V.size(n),l=n.length,a=V.normalizeAxis(t.axis,l),d=a<n.length-1,p,c=[];d?(c=Array.from({length:l},(U,k)=>k),c[a]=l-1,c[l-1]=a,p=e.compute(Rt(r,c),{inputs:[r],outputs:[-1]})[0]):p=r;let g=p.dims,_=g[l-1],w=s/_,C=ut(_),x=_/C,S=64;w===1&&(S=256);let N=(U,k)=>k===4?`max(max(${U}.x, ${U}.y), max(${U}.z, ${U}.w))`:k===2?`max(${U}.x, ${U}.y)`:k===3?`max(max(${U}.x, ${U}.y), ${U}.z)`:U,E=Z("x",p.dataType,p.dims,C),T=we("result",p.dataType,p.dims,C),B=E.type.value,L=ht(p.dataType)==="f32"?`var threadMax = ${B}(-3.4028234663852886e+38f);`:`var threadMax = ${B}(-65504.0h);`,M=U=>`
      var<workgroup> rowMaxShared : ${B};
      var<workgroup> rowSumShared : ${B};
      var<workgroup> threadShared : array<${B}, ${S}>;

      fn getValue(row: i32, col: i32, row_stride: i32) -> ${B} {
        let index = row * row_stride + col;
        return x[index];
      }

      fn setValue(row: i32, col: i32, row_stride: i32, value: ${B}) {
        let index = row * row_stride + col;
        result[index] = value;
      }
      ${U.registerUniform("packedCols","i32").declareVariables(E,T)}
      ${U.mainStart(S)}
        let gindex = i32(global_idx);
        let lindex = i32(local_idx);
        const wg = ${S};
        let row = gindex / wg;
        let cols = uniforms.packedCols;
        let row_stride : i32 = uniforms.packedCols;

        // find the rows max
        ${L}
        for (var col = lindex; col < cols; col += wg) {
          let value = getValue(row, col, row_stride);
          threadMax = max(threadMax, value);
        }
        if (lindex < cols) {
          threadShared[lindex] = threadMax;
        }
        workgroupBarrier();

        var reduceSize = min(cols, wg);
        for (var currSize = reduceSize >> 1;  currSize > 0; currSize = reduceSize >> 1) {
          reduceSize = currSize + (reduceSize & 1);
          if (lindex < currSize) {
            threadShared[lindex] = max(threadShared[lindex], threadShared[lindex + reduceSize]);
          }
          workgroupBarrier();
        }
        if (lindex == 0) {
          rowMaxShared = ${B}(${N("threadShared[0]",C)});
        }
        workgroupBarrier();

        // find the rows sum
        var threadSum = ${B}(0.0);
        for (var col = lindex; col < cols; col += wg) {
          let subExp = exp(getValue(row, col, row_stride) - rowMaxShared);
          threadSum += subExp;
        }
        threadShared[lindex] = threadSum;
        workgroupBarrier();

        for (var currSize = wg >> 1;  currSize > 0; currSize = currSize >> 1) {
          if (lindex < currSize) {
            threadShared[lindex] = threadShared[lindex] + threadShared[lindex + currSize];
          }
          workgroupBarrier();
        }
        if (lindex == 0) {
          rowSumShared = ${B}(${Bi("threadShared[0]",C)});
        }
        workgroupBarrier();

        // calculate final value for each element in the row
        for (var col = lindex; col < cols; col += wg) {
          var value = exp(getValue(row, col, row_stride) - rowMaxShared) / rowSumShared;
          // max operation protects against NaN since all values should be >=0
          value = max(value, ${B}(0.0));
          setValue(row, col, row_stride, value);
        }
      }`,F=e.compute({name:"Softmax",shaderCache:{hint:`${C};${S}`,inputDependencies:["type"]},getRunData:()=>({outputs:[{dims:g,dataType:p.dataType}],dispatchGroup:{x:w},programUniforms:[{type:6,data:x}]}),getShaderSource:M},{inputs:[p],outputs:[d?-1:0]})[0];d&&e.compute(Rt(F,c),{inputs:[F]})},Zg=(e,t)=>{vf(e.inputs),wf(e,t)},Jg=e=>Ze({axis:e.axis})}),jv=de(()=>{"use strict";Oe(),Me(),Re(),Eo=e=>Array.from(e.getBigInt64Array(),Number),bf=e=>{if(!e||e.length!==2)throw new Error("Tile requires 2 inputs.");if(e[0].dataType!==1&&e[0].dataType!==10&&e[0].dataType!==6&&e[0].dataType!==12)throw new Error("Tile only support float, float16, int32, and uint32 data types");if(e[1].dataType!==7)throw new Error("Tile `repeats` input should be of int64 data type");if(e[1].dims.length!==1)throw new Error("Tile `repeats` input should be 1-D");if(Eo(e[1]).length!==e[0].dims.length)throw new Error("Tile `repeats` input should have same number of elements as rank of input data tensor")},xf=(e,t)=>{let r=[];for(let n=0;n<e.length;++n)r.push(e[n]*t[n]);return r},$f=(e,t)=>{let r=e[0].dims,n=t??Eo(e[1]),s=xf(r,n),l=V.size(s),a=e[0].dataType,d=Z("input",a,r.length),p=we("output",a,s.length),c=g=>`
      const inputShape = ${d.indices(...r)};
      ${g.registerUniform("output_size","u32").declareVariables(d,p)}
      ${g.mainStart()}
      ${g.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
      let output_indices = ${p.offsetToIndices("global_idx")};
      var input_indices: ${d.type.indices};
      for (var i = 0; i < ${r.length}; i++) {
        let input_dim_i = ${d.indicesGet("uniforms.input_shape","i")};
        let input_dim_value = ${p.indicesGet("output_indices","i")}  % input_dim_i;

        ${d.indicesSet("input_indices","i","input_dim_value")}
      }
      ${p.setByOffset("global_idx",d.getByIndices("input_indices"))}
    }`;return{name:"Tile",shaderCache:{hint:`${n}`,inputDependencies:["rank"]},getRunData:()=>({outputs:[{dims:s,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(l/64)},programUniforms:[{type:12,data:l},...Pe(e[0].dims,s)]}),getShaderSource:c}},Qg=e=>{bf(e.inputs),e.compute($f(e.inputs),{inputs:[0]})}}),Kv=de(()=>{"use strict";Oe(),Me(),Re(),Cf=(e,t,r,n,s)=>{let l=we("output_data",s,r.length,4),a=Z("a_data",t[1].dataType,t[1].dims.length,4),d=Z("b_data",t[2].dataType,t[2].dims.length,4),p=Z("c_data",t[0].dataType,t[0].dims.length,4),c,g=(_,w,C)=>`select(${w}, ${_}, ${C})`;if(!n)c=l.setByOffset("global_idx",g(a.getByOffset("global_idx"),d.getByOffset("global_idx"),p.getByOffset("global_idx")));else{let _=(w,C,x="")=>{let S=`a_data[index_a${C}][component_a${C}]`,N=`b_data[index_b${C}][component_b${C}]`,E=`bool(c_data[index_c${C}] & (0xffu << (component_c${C} * 8)))`;return`
            let output_indices${C} = ${l.offsetToIndices(`global_idx * 4u + ${C}u`)};
            let offset_a${C} = ${a.broadcastedIndicesToOffset(`output_indices${C}`,l)};
            let offset_b${C} = ${d.broadcastedIndicesToOffset(`output_indices${C}`,l)};
            let offset_c${C} = ${p.broadcastedIndicesToOffset(`output_indices${C}`,l)};
            let index_a${C} = offset_a${C} / 4u;
            let index_b${C} = offset_b${C} / 4u;
            let index_c${C} = offset_c${C} / 4u;
            let component_a${C} = offset_a${C} % 4u;
            let component_b${C} = offset_b${C} % 4u;
            let component_c${C} = offset_c${C} % 4u;
            ${w}[${C}] = ${x}(${g(S,N,E)});
          `};s===9?c=`
            var data = vec4<u32>(0);
            ${_("data",0,"u32")}
            ${_("data",1,"u32")}
            ${_("data",2,"u32")}
            ${_("data",3,"u32")}
            output_data[global_idx] = dot(vec4<u32>(0x1, 0x100, 0x10000, 0x1000000), vec4<u32>(data));`:c=`
            ${_("output_data[global_idx]",0)}
            ${_("output_data[global_idx]",1)}
            ${_("output_data[global_idx]",2)}
            ${_("output_data[global_idx]",3)}
          `}return`
        ${e.registerUniform("vec_size","u32").declareVariables(p,a,d,l)}
        ${e.mainStart()}
        ${e.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}
        ${c}
      }`},If=e=>{let t=e[1].dims,r=e[2].dims,n=e[0].dims,s=e[1].dataType,l=!(V.areEqual(t,r)&&V.areEqual(r,n)),a=t,d=V.size(t);if(l){let c=ar.calcShape(ar.calcShape(t,r,!1),n,!1);if(!c)throw new Error("Can't perform where op on the given tensors");a=c,d=V.size(a)}let p=Math.ceil(d/4);return{name:"Where",shaderCache:{inputDependencies:["rank","rank","rank"]},getShaderSource:c=>Cf(c,e,a,l,s),getRunData:()=>({outputs:[{dims:a,dataType:s}],dispatchGroup:{x:Math.ceil(d/64/4)},programUniforms:[{type:12,data:p},...Pe(n,t,r,a)]})}},e0=e=>{e.compute(If(e.inputs))}}),Zv=de(()=>{"use strict";dv(),da(),pv(),cv(),fv(),hv(),mv(),wv(),xv(),$v(),Cv(),Iv(),Tv(),Sv(),Pv(),Ev(),Av(),Ov(),kv(),Nv(),Bv(),Lv(),Mv(),Rv(),Dv(),zv(),wg(),Fv(),Uv(),qv(),Wv(),Xv(),ua(),Yv(),Ig(),Gv(),Hv(),Vv(),$g(),jv(),Li(),pa(),Kv(),t0=new Map([["Abs",[Yh]],["Acos",[Gh]],["Acosh",[Hh]],["Add",[Pm]],["ArgMax",[Uh,zo]],["ArgMin",[Fh,zo]],["Asin",[Vh]],["Asinh",[jh]],["Atan",[Kh]],["Atanh",[Zh]],["Attention",[qh]],["AveragePool",[Bg,Ng]],["BatchNormalization",[Wh]],["BiasAdd",[Xh]],["BiasSplitGelu",[Sm]],["Cast",[Qh,Jh]],["Ceil",[tm]],["Clip",[em]],["Concat",[Dm,zm]],["Conv",[Yo,Xo]],["ConvTranspose",[jm,Vm]],["Cos",[im]],["Cosh",[rm]],["CumSum",[Km,Zm]],["DepthToSpace",[Jm,Qm]],["DequantizeLinear",[Ug,qg]],["DFT",[eg,tg]],["Div",[Em]],["Einsum",[ig,rg]],["Elu",[nm,Or]],["Equal",[Am]],["Erf",[sm]],["Exp",[om]],["Expand",[ng]],["FastGelu",[sg]],["Floor",[am]],["FusedConv",[Yo,Xo]],["Gather",[ag,og]],["GatherElements",[fg,cg]],["GatherBlockQuantized",[dg,pg]],["GatherND",[lg,ug]],["Gelu",[lm]],["Gemm",[mg,hg]],["GlobalAveragePool",[Mg,Lg]],["GlobalMaxPool",[Fg,zg]],["Greater",[Bm]],["GreaterOrEqual",[Mm]],["GridSample",[gg,yg]],["GroupQueryAttention",[Tg]],["HardSigmoid",[gm,mm]],["HardSwish",[ym]],["InstanceNormalization",[Sg]],["LayerNormalization",[Pg]],["LeakyRelu",[um,Or]],["Less",[Lm]],["LessOrEqual",[Rm]],["Log",[Im]],["MatMul",[Eg]],["MatMulNBits",[Ag,Og]],["MaxPool",[Rg,Dg]],["Mul",[Om]],["MultiHeadAttention",[vg,_g]],["Neg",[pm]],["Not",[dm]],["Pad",[kg]],["Pow",[km]],["QuickGelu",[Tm,Or]],["Range",[Wg]],["Reciprocal",[cm]],["ReduceMin",[Lh]],["ReduceMean",[Ah]],["ReduceMax",[Bh]],["ReduceSum",[Rh]],["ReduceProd",[Mh]],["ReduceL1",[Oh]],["ReduceL2",[kh]],["ReduceLogSum",[zh]],["ReduceLogSumExp",[Nh]],["ReduceSumSquare",[Dh]],["Relu",[fm]],["Resize",[Gg,Hg]],["RotaryEmbedding",[Cg]],["ScatterND",[Yg,Xg]],["Sigmoid",[hm]],["Sin",[_m]],["Sinh",[vm]],["Slice",[jg,Kg]],["SkipLayerNormalization",[Vg]],["Split",[bg,xg]],["Sqrt",[wm]],["Softmax",[Zg,Jg]],["Sub",[Nm]],["Tan",[bm]],["Tanh",[xm]],["ThresholdedRelu",[Cm,Or]],["Tile",[Qg]],["Transpose",[_h,vh]],["Where",[e0]]])}),Jv=de(()=>{"use strict";Wt(),wi(),Re(),i0=class{constructor(e){this.backend=e,this.repo=new Map,this.attributesBound=!1}getArtifact(e){return this.repo.get(e)}setArtifact(e,t){this.repo.set(e,t)}run(e,t,r,n,s){ti(e.programInfo.name);let l=this.backend.device,a=this.backend.getComputePassEncoder();this.backend.writeTimestamp(this.backend.pendingDispatchNumber*2);let d=[];for(let c of t)d.push({binding:d.length,resource:{buffer:c.buffer}});for(let c of r)d.push({binding:d.length,resource:{buffer:c.buffer}});s&&d.push({binding:d.length,resource:s});let p=l.createBindGroup({layout:e.computePipeline.getBindGroupLayout(0),entries:d,label:e.programInfo.name});if(this.backend.sessionStatus==="capturing"){let c={kernelId:this.backend.currentKernelId,computePipeline:e.computePipeline,bindGroup:p,dispatchGroup:n};this.backend.capturedCommandList.get(this.backend.currentSessionId).push(c)}a.setPipeline(e.computePipeline),a.setBindGroup(0,p),a.dispatchWorkgroups(...n),this.backend.writeTimestamp(this.backend.pendingDispatchNumber*2+1),this.backend.pendingDispatchNumber++,(this.backend.pendingDispatchNumber>=this.backend.maxDispatchNumber||this.backend.queryType==="at-passes")&&this.backend.endComputePass(),this.backend.pendingDispatchNumber>=this.backend.maxDispatchNumber&&this.backend.flush(),qt(e.programInfo.name)}dispose(){}build(e,t){ti(e.name);let r=this.backend.device,n=[];[{feature:"shader-f16",extension:"f16"},{feature:"subgroups",extension:"subgroups"}].forEach(c=>{r.features.has(c.feature)&&n.push(`enable ${c.extension};`)});let s=yh(t,this.backend.device.limits),l=e.getShaderSource(s),a=`${n.join(`
`)}
${s.additionalImplementations}
${l}`,d=r.createShaderModule({code:a,label:e.name});Ve("verbose",()=>`[WebGPU] ${e.name} shader code: ${a}`);let p=r.createComputePipeline({compute:{module:d,entryPoint:"main"},layout:"auto",label:e.name});return qt(e.name),{programInfo:e,computePipeline:p,uniformVariablesInfo:s.variablesInfo}}normalizeDispatchGroupSize(e){let t=typeof e=="number"?e:e.x,r=typeof e=="number"?1:e.y||1,n=typeof e=="number"?1:e.z||1,s=this.backend.device.limits.maxComputeWorkgroupsPerDimension;if(t<=s&&r<=s&&n<=s)return[t,r,n];let l=t*r*n,a=Math.ceil(Math.sqrt(l));if(a>s){if(a=Math.ceil(Math.cbrt(l)),a>s)throw new Error("Total dispatch size exceeds WebGPU maximum.");return[a,a,a]}else return[a,a,1]}}}),r0={};ur(r0,{WebGpuBackend:()=>n0});Qv=de(()=>{"use strict";Wt(),Oe(),wi(),ch(),lv(),Zv(),Jv(),Tf=(e,t)=>{if(t.length!==e.length)throw new Error(`inputDependencies length ${t.length} is not equal to inputTensors length ${e.length}.`);let r=[];for(let n=0;n<e.length;++n){let s=e[n].dataType;switch(t[n]){case"none":{r.push("");break}case"type":{r.push(`${s}`);break}case"rank":{let l=e[n].dims.length;r.push(`${s};${l}`);break}case"dims":{let l=e[n].dims.join(",");r.push(`${s};${l}`);break}default:throw new Error(`unsupported input dependency: ${t[n]}`)}}return r.join("|")},Sf=(e,t,r)=>{let n=e.name;return e.shaderCache?.hint&&(n+="["+e.shaderCache.hint+"]"),n+=":"+r+`:${Tf(t,e.shaderCache?.inputDependencies??new Array(t.length).fill("dims"))}`,n},Pf=class{constructor(e){e&&(this.architecture=e.architecture,this.vendor=e.vendor)}isArchitecture(e){return this.architecture===e}isVendor(e){return this.vendor===e}},n0=class{constructor(){this.currentSessionId=null,this.currentKernelId=null,this.commandEncoder=null,this.computePassEncoder=null,this.maxDispatchNumber=16,this.pendingDispatchNumber=0,this.pendingKernels=[],this.pendingQueries=new Map,this.sessionStatus="default",this.capturedCommandList=new Map,this.capturedPendingKernels=new Map,this.sessionExternalDataMapping=new Map}get currentKernelCustomData(){if(this.currentKernelId===null)throw new Error("currentKernelCustomData(): currentKernelId is null. (should not happen)");let e=this.kernelCustomData.get(this.currentKernelId);return e||(e={},this.kernelCustomData.set(this.currentKernelId,e)),e}async initialize(e,t){this.env=e;let r=[],n={requiredLimits:{maxComputeWorkgroupStorageSize:t.limits.maxComputeWorkgroupStorageSize,maxComputeWorkgroupsPerDimension:t.limits.maxComputeWorkgroupsPerDimension,maxStorageBufferBindingSize:t.limits.maxStorageBufferBindingSize,maxBufferSize:t.limits.maxBufferSize,maxComputeInvocationsPerWorkgroup:t.limits.maxComputeInvocationsPerWorkgroup,maxComputeWorkgroupSizeX:t.limits.maxComputeWorkgroupSizeX,maxComputeWorkgroupSizeY:t.limits.maxComputeWorkgroupSizeY,maxComputeWorkgroupSizeZ:t.limits.maxComputeWorkgroupSizeZ},requiredFeatures:r},s=d=>t.features.has(d)&&r.push(d)&&!0;s("chromium-experimental-timestamp-query-inside-passes")||s("timestamp-query"),s("shader-f16"),s("subgroups"),this.device=await t.requestDevice(n);let l=t,a=t.info??(typeof l.requestAdapterInfo=="function"?await l.requestAdapterInfo():void 0);this.adapterInfo=new Pf(a),this.gpuDataManager=mh(this),this.programManager=new i0(this),this.kernels=new Map,this.kernelPersistentData=new Map,this.kernelCustomData=new Map,sa(e.logLevel,!!e.debug),this.device.onuncapturederror=d=>{d.error instanceof GPUValidationError&&console.error(`An uncaught WebGPU validation error was raised: ${d.error.message}`)},Object.defineProperty(this.env.webgpu,"device",{value:this.device,writable:!1,enumerable:!0,configurable:!0}),Object.defineProperty(this.env.webgpu,"adapter",{value:t,writable:!1,enumerable:!0,configurable:!1}),this.setQueryType()}dispose(){typeof this.querySet<"u"&&this.querySet.destroy(),this.gpuDataManager.dispose(),this.device&&this.env?.webgpu&&this.device.lost.then(()=>{delete this.env.webgpu.device})}getCommandEncoder(){return this.commandEncoder||(this.commandEncoder=this.device.createCommandEncoder()),this.commandEncoder}getComputePassEncoder(){if(!this.computePassEncoder){let e=this.getCommandEncoder(),t={};this.queryType==="at-passes"&&(t.timestampWrites={querySet:this.querySet,beginningOfPassWriteIndex:this.pendingDispatchNumber*2,endOfPassWriteIndex:this.pendingDispatchNumber*2+1}),this.computePassEncoder=e.beginComputePass(t)}return this.computePassEncoder}endComputePass(){this.computePassEncoder&&(this.computePassEncoder.end(),this.computePassEncoder=null)}flush(){if(!this.commandEncoder)return;ti(),this.endComputePass();let e;this.queryType!=="none"&&(this.commandEncoder.resolveQuerySet(this.querySet,0,this.pendingDispatchNumber*2,this.queryResolveBuffer,0),e=this.device.createBuffer({size:this.pendingDispatchNumber*2*8,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),this.pendingQueries.set(e,this.pendingKernels),this.pendingKernels=[],this.commandEncoder.copyBufferToBuffer(this.queryResolveBuffer,0,e,0,this.pendingDispatchNumber*2*8)),this.device.queue.submit([this.commandEncoder.finish()]),this.gpuDataManager.refreshPendingBuffers(),this.commandEncoder=null,this.pendingDispatchNumber=0,this.queryType!=="none"&&e.mapAsync(GPUMapMode.READ).then(()=>{let t=new BigUint64Array(e.getMappedRange()),r=this.pendingQueries.get(e);for(let n=0;n<t.length/2;n++){let s=r[n],l=s.kernelId,a=this.kernels.get(l),d=a.kernelType,p=a.kernelName,c=s.programName,g=s.inputTensorViews,_=s.outputTensorViews,w=t[n*2],C=t[n*2+1];typeof this.queryTimeBase>"u"&&(this.queryTimeBase=w);let x=Number(w-this.queryTimeBase),S=Number(C-this.queryTimeBase);if(!Number.isSafeInteger(x)||!Number.isSafeInteger(S))throw new RangeError("incorrect timestamp range");if(this.env.webgpu.profiling?.ondata)this.env.webgpu.profiling.ondata({version:1,inputsMetadata:g.map(N=>({dims:N.dims,dataType:vi(N.dataType)})),outputsMetadata:_.map(N=>({dims:N.dims,dataType:vi(N.dataType)})),kernelId:l,kernelType:d,kernelName:p,programName:c,startTime:x,endTime:S});else{let N="";g.forEach((T,B)=>{N+=`input[${B}]: [${T.dims}] | ${vi(T.dataType)}, `});let E="";_.forEach((T,B)=>{E+=`output[${B}]: [${T.dims}] | ${vi(T.dataType)}, `}),console.log(`[profiling] kernel "${l}|${d}|${p}|${c}" ${N}${E}start time: ${x} ns, execution time: ${S-x} ns`)}Lr("GPU",`${c}::${w}::${C}`)}e.unmap(),this.pendingQueries.delete(e)}),qt()}run(e,t,r,n,s,l){ti(e.name);let a=[];for(let T=0;T<t.length;++T){let B=t[T].data;if(B===0)continue;let L=this.gpuDataManager.get(B);if(!L)throw new Error(`no GPU data for input: ${B}`);a.push(L)}let{outputs:d,dispatchGroup:p,programUniforms:c}=e.getRunData(t),g=r.length===0?d.map((T,B)=>B):r;if(g.length!==d.length)throw new Error(`Output size ${g.length} must be equal to ${d.length}.`);let _=[],w=[];for(let T=0;T<d.length;++T){if(!Number.isInteger(g[T])||g[T]<-3||g[T]>=l)throw new Error(`Invalid output index: ${g[T]}`);if(g[T]===-3)continue;let B=g[T]===-1,L=g[T]===-2,M=B||L?s(d[T].dataType,d[T].dims):n(g[T],d[T].dataType,d[T].dims);if(_.push(M),M.data===0)continue;let F=this.gpuDataManager.get(M.data);if(!F)throw new Error(`no GPU data for output: ${M.data}`);if(B&&this.temporaryData.push(F),L){let U=this.kernelPersistentData.get(this.currentKernelId);U||(U=[],this.kernelPersistentData.set(this.currentKernelId,U)),U.push(F)}w.push(F)}if(a.length!==t.length||w.length!==_.length){if(w.length===0)return qt(e.name),_;throw new Error(`Program ${e.name} has zero-sized tensor(s) in inputs or outputs. This is not supported now.`)}let C;if(c){let T=0,B=[];c.forEach(U=>{let k=typeof U.data=="number"?[U.data]:U.data;if(k.length===0)return;let re=U.type===10?2:4,oe,ye;U.type===10?(ye=k.length>4?16:k.length>2?8:k.length*re,oe=k.length>4?16:re*k.length):(ye=k.length<=2?k.length*re:16,oe=16),T=Math.ceil(T/ye)*ye,B.push(T);let fe=U.type===10?8:4;T+=k.length>4?Math.ceil(k.length/fe)*oe:k.length*re});let L=16;T=Math.ceil(T/L)*L;let M=new ArrayBuffer(T);c.forEach((U,k)=>{let re=B[k],oe=typeof U.data=="number"?[U.data]:U.data;if(U.type===6)new Int32Array(M,re,oe.length).set(oe);else if(U.type===12)new Uint32Array(M,re,oe.length).set(oe);else if(U.type===10)new Uint16Array(M,re,oe.length).set(oe);else if(U.type===1)new Float32Array(M,re,oe.length).set(oe);else throw new Error(`Unsupported uniform type: ${vi(U.type)}`)});let F=this.gpuDataManager.create(T,GPUBufferUsage.COPY_DST|GPUBufferUsage.UNIFORM);this.device.queue.writeBuffer(F.buffer,0,M,0,T),this.gpuDataManager.release(F.id),C={offset:0,size:T,buffer:F.buffer}}let x=this.programManager.normalizeDispatchGroupSize(p),S=x[1]===1&&x[2]===1,N=Sf(e,t,S),E=this.programManager.getArtifact(N);if(E||(E=this.programManager.build(e,x),this.programManager.setArtifact(N,E),Ve("info",()=>`[artifact] key: ${N}, programName: ${e.name}`)),c&&E.uniformVariablesInfo){if(c.length!==E.uniformVariablesInfo.length)throw new Error(`Uniform variables count mismatch: expect ${E.uniformVariablesInfo.length}, got ${c.length} in program "${E.programInfo.name}".`);for(let T=0;T<c.length;T++){let B=c[T],L=B.type,M=typeof B.data=="number"?1:B.data.length,[F,U]=E.uniformVariablesInfo[T];if(L!==F||M!==U)throw new Error(`Uniform variable ${T} mismatch: expect type ${F} with size ${U}, got type ${L} with size ${M} in program "${E.programInfo.name}".`)}}if(Ve("info",()=>`[ProgramManager] run "${e.name}" (key=${N}) with ${x[0]}x${x[1]}x${x[2]}`),this.queryType!=="none"||this.sessionStatus==="capturing"){let T={kernelId:this.currentKernelId,programName:E.programInfo.name,inputTensorViews:t,outputTensorViews:_};this.pendingKernels.push(T),this.sessionStatus==="capturing"&&this.capturedPendingKernels.get(this.currentSessionId).push(T)}return this.programManager.run(E,a,w,x,C),qt(e.name),_}upload(e,t){this.gpuDataManager.upload(e,t)}memcpy(e,t){this.gpuDataManager.memcpy(e,t)}async download(e,t){await this.gpuDataManager.download(e,t)}alloc(e){return this.gpuDataManager.create(e).id}free(e){return this.gpuDataManager.release(e)}createKernel(e,t,r,n){let s=t0.get(e);if(!s)throw new Error(`kernel not implemented: ${e}`);let l={kernelType:e,kernelName:n,kernelEntry:s[0],attributes:[s[1],r]};this.kernels.set(t,l)}releaseKernel(e){let t=this.kernelPersistentData.get(e);if(t){for(let r of t)this.gpuDataManager.release(r.id);this.kernelPersistentData.delete(e)}this.kernelCustomData.delete(e),this.kernels.delete(e)}computeKernel(e,t,r){let n=this.kernels.get(e);if(!n)throw new Error(`kernel not created: ${e}`);let s=n.kernelType,l=n.kernelName,a=n.kernelEntry,d=n.attributes;if(this.currentKernelId!==null)throw new Error(`kernel "[${s}] ${l}" is not allowed to be called recursively`);this.currentKernelId=e,d[0]&&(d[1]=d[0](d[1]),d[0]=void 0),Ve("info",()=>`[WebGPU] Start to run kernel "[${s}] ${l}"...`);let p=this.env.debug;this.temporaryData=[];try{return p&&this.device.pushErrorScope("validation"),a(t,d[1]),0}catch(c){return r.push(Promise.resolve(`[WebGPU] Kernel "[${s}] ${l}" failed. ${c}`)),1}finally{p&&r.push(this.device.popErrorScope().then(c=>c?`GPU validation error for kernel "[${s}] ${l}": ${c.message}`:null));for(let c of this.temporaryData)this.gpuDataManager.release(c.id);this.temporaryData=[],this.currentKernelId=null}}registerBuffer(e,t,r,n){let s=this.sessionExternalDataMapping.get(e);s||(s=new Map,this.sessionExternalDataMapping.set(e,s));let l=s.get(t),a=this.gpuDataManager.registerExternalBuffer(r,n,l);return s.set(t,[a,r]),a}unregisterBuffers(e){let t=this.sessionExternalDataMapping.get(e);t&&(t.forEach(r=>this.gpuDataManager.unregisterExternalBuffer(r[0])),this.sessionExternalDataMapping.delete(e))}getBuffer(e){let t=this.gpuDataManager.get(e);if(!t)throw new Error(`no GPU data for buffer: ${e}`);return t.buffer}createDownloader(e,t,r){return async()=>{let n=await Mo(this,e,t);return oa(n.buffer,r)}}writeTimestamp(e){this.queryType==="inside-passes"&&this.computePassEncoder.writeTimestamp(this.querySet,e)}setQueryType(){this.queryType="none",(this.env.webgpu.profiling?.mode==="default"||(typeof this.env.trace>"u"?this.env.wasm.trace:this.env.trace))&&(this.device.features.has("chromium-experimental-timestamp-query-inside-passes")?this.queryType="inside-passes":this.device.features.has("timestamp-query")&&(this.queryType="at-passes"),this.queryType!=="none"&&typeof this.querySet>"u"&&(this.querySet=this.device.createQuerySet({type:"timestamp",count:this.maxDispatchNumber*2}),this.queryResolveBuffer=this.device.createBuffer({size:this.maxDispatchNumber*2*8,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.QUERY_RESOLVE})))}captureBegin(){Ve("info","captureBegin"),this.capturedCommandList.get(this.currentSessionId)||this.capturedCommandList.set(this.currentSessionId,[]),this.capturedPendingKernels.get(this.currentSessionId)||this.capturedPendingKernels.set(this.currentSessionId,[]),this.flush(),this.sessionStatus="capturing"}captureEnd(){Ve("info","captureEnd"),this.flush(),this.sessionStatus="default"}replay(){Ve("info","replay"),this.sessionStatus="replaying";let e=this.capturedCommandList.get(this.currentSessionId),t=this.capturedPendingKernels.get(this.currentSessionId),r=e.length;this.pendingKernels=[];for(let n=0;n<r;n++){let s=this.getComputePassEncoder(),l=e[n];this.writeTimestamp(this.pendingDispatchNumber*2),s.setPipeline(l.computePipeline),s.setBindGroup(0,l.bindGroup),s.dispatchWorkgroups(...l.dispatchGroup),this.writeTimestamp(this.pendingDispatchNumber*2+1),this.pendingDispatchNumber++,this.queryType!=="none"&&this.pendingKernels.push(t[n]),(this.pendingDispatchNumber>=this.maxDispatchNumber||this.queryType==="at-passes")&&this.endComputePass(),this.pendingDispatchNumber>=this.maxDispatchNumber&&this.flush()}this.flush(),this.sessionStatus="default"}onCreateSession(){this.gpuDataManager.onCreateSession()}onReleaseSession(e){this.unregisterBuffers(e),this.capturedCommandList.has(e)&&this.capturedCommandList.delete(e),this.capturedPendingKernels.has(e)&&this.capturedPendingKernels.delete(e),this.gpuDataManager.onReleaseSession(e)}onRunStart(e){this.currentSessionId=e,this.setQueryType()}}}),s0={};ur(s0,{init:()=>o0});ew=de(()=>{"use strict";Oe(),wi(),Me(),av(),bn=class a0{constructor(t,r,n,s){this.module=t,this.dataType=r,this.data=n,this.dims=s}getFloat32Array(){if(this.dataType!==1)throw new Error("Invalid data type");let t=V.size(this.dims);return t===0?new Float32Array:new Float32Array(this.module.HEAP8.buffer,this.data,t)}getBigInt64Array(){if(this.dataType!==7)throw new Error("Invalid data type");let t=V.size(this.dims);return t===0?new BigInt64Array:new BigInt64Array(this.module.HEAP8.buffer,this.data,t)}getInt32Array(){if(this.dataType!==6)throw new Error("Invalid data type");let t=V.size(this.dims);return t===0?new Int32Array:new Int32Array(this.module.HEAP8.buffer,this.data,t)}getUint16Array(){if(this.dataType!==10&&this.dataType!==4)throw new Error("Invalid data type");let t=V.size(this.dims);return t===0?new Uint16Array:new Uint16Array(this.module.HEAP8.buffer,this.data,t)}reshape(t){if(V.size(t)!==V.size(this.dims))throw new Error("Invalid new shape");return new a0(this.module,this.dataType,this.data,t)}},Ef=class{constructor(e,t,r){this.module=e,this.backend=t,this.customDataOffset=0,this.customDataSize=0,this.adapterInfo=t.adapterInfo;let n=e.PTR_SIZE,s=r/e.PTR_SIZE,l=n===4?"i32":"i64";this.opKernelContext=Number(e.getValue(n*s++,l));let a=Number(e.getValue(n*s++,l));this.outputCount=Number(e.getValue(n*s++,l)),this.customDataOffset=Number(e.getValue(n*s++,"*")),this.customDataSize=Number(e.getValue(n*s++,l));let d=[];for(let p=0;p<a;p++){let c=Number(e.getValue(n*s++,l)),g=Number(e.getValue(n*s++,"*")),_=Number(e.getValue(n*s++,l)),w=[];for(let C=0;C<_;C++)w.push(Number(e.getValue(n*s++,l)));d.push(new bn(e,c,g,w))}this.inputs=d}get kernelCustomData(){return this.backend.currentKernelCustomData}get customDataBuffer(){return this.module.HEAPU8.subarray(this.customDataOffset,this.customDataOffset+this.customDataSize)}compute(e,t){let r=t?.inputs?.map(a=>typeof a=="number"?this.inputs[a]:a)??this.inputs,n=t?.outputs??[],s=(a,d,p)=>new bn(this.module,d,this.output(a,p),p),l=(a,d)=>{let p=ji(a,d);if(!p)throw new Error(`Unsupported data type: ${a}`);let c=p>0?this.backend.gpuDataManager.create(p).id:0;return new bn(this.module,a,c,d)};return this.backend.run(e,r,n,s,l,this.outputCount)}output(e,t){let r=this.module.stackSave();try{let n=this.module.PTR_SIZE,s=n===4?"i32":"i64",l=this.module.stackAlloc((1+t.length)*n);this.module.setValue(l,t.length,s);for(let a=0;a<t.length;a++)this.module.setValue(l+n*(a+1),t[a],s);return this.module._JsepOutput(this.opKernelContext,e,l)}catch(n){throw new Error(`Failed to generate kernel's output[${e}] with dims [${t}]. If you are running with pre-allocated output, please make sure the output type/dims are correct. Error: ${n}`)}finally{this.module.stackRestore(r)}}},o0=async(e,t,r,n)=>{let s=t.jsepInit;if(!s)throw new Error("Failed to initialize JSEP. The WebAssembly module is not built with JSEP support.");if(e==="webgpu"){let l=(Qv(),Br(r0)).WebGpuBackend,a=new l;await a.initialize(r,n),s("webgpu",[a,d=>a.alloc(Number(d)),d=>a.free(d),(d,p,c,g=!1)=>{if(g)Ve("verbose",()=>`[WebGPU] jsepCopyGpuToGpu: src=${Number(d)}, dst=${Number(p)}, size=${Number(c)}`),a.memcpy(Number(d),Number(p));else{Ve("verbose",()=>`[WebGPU] jsepCopyCpuToGpu: dataOffset=${Number(d)}, gpuDataId=${Number(p)}, size=${Number(c)}`);let _=t.HEAPU8.subarray(Number(d>>>0),Number(d>>>0)+Number(c));a.upload(Number(p),_)}},async(d,p,c)=>{Ve("verbose",()=>`[WebGPU] jsepCopyGpuToCpu: gpuDataId=${d}, dataOffset=${p}, size=${c}`),await a.download(Number(d),()=>t.HEAPU8.subarray(Number(p)>>>0,Number(p+c)>>>0))},(d,p,c)=>a.createKernel(d,Number(p),c,t.UTF8ToString(t._JsepGetNodeName(Number(p)))),d=>a.releaseKernel(d),(d,p,c,g)=>{Ve("verbose",()=>`[WebGPU] jsepRun: sessionHandle=${c}, kernel=${d}, contextDataOffset=${p}`);let _=new Ef(t,a,Number(p));return a.computeKernel(Number(d),_,g)},()=>a.captureBegin(),()=>a.captureEnd(),()=>a.replay()])}else{let l=new hh(r);s("webnn",[l,()=>l.reserveTensorId(),a=>l.releaseTensorId(a),async(a,d,p,c,g)=>l.ensureTensor(a,d,p,c,g),(a,d)=>{l.uploadTensor(a,d)},async(a,d)=>l.downloadTensor(a,d),(a,d)=>l.registerMLContext(a,d),!!r.trace])}}}),l0=de(()=>{"use strict";Wt(),nv(),sv(),Oe(),er(),ta(),lh(),Af=(e,t)=>{ot()._OrtInit(e,t)!==0&&tt("Can't initialize onnxruntime.")},ya=async e=>{Af(e.wasm.numThreads,Sn(e.logLevel))},_a=async(e,t)=>{ot().asyncInit?.();let r=e.webgpu.adapter;if(t==="webgpu"){if(typeof navigator>"u"||!navigator.gpu)throw new Error("WebGPU is not supported in current environment");if(r){if(typeof r.limits!="object"||typeof r.features!="object"||typeof r.requestDevice!="function")throw new Error("Invalid GPU adapter set in `env.webgpu.adapter`. It must be a GPUAdapter object.")}else{let n=e.webgpu.powerPreference;if(n!==void 0&&n!=="low-power"&&n!=="high-performance")throw new Error(`Invalid powerPreference setting: "${n}"`);let s=e.webgpu.forceFallbackAdapter;if(s!==void 0&&typeof s!="boolean")throw new Error(`Invalid forceFallbackAdapter setting: "${s}"`);if(r=await navigator.gpu.requestAdapter({powerPreference:n,forceFallbackAdapter:s}),!r)throw new Error('Failed to get GPU adapter. You may need to enable flag "--enable-unsafe-webgpu" if you are using Chrome.')}}if(t==="webnn"&&(typeof navigator>"u"||!navigator.ml))throw new Error("WebNN is not supported in current environment");{let n=(ew(),Br(s0)).init;t==="webgpu"&&await n("webgpu",ot(),e,r),t==="webnn"&&await n("webnn",ot(),e)}},Ei=new Map,Of=e=>{let t=ot(),r=t.stackSave();try{let n=t.PTR_SIZE,s=t.stackAlloc(2*n);t._OrtGetInputOutputCount(e,s,s+n)!==0&&tt("Can't get session input/output count.");let l=n===4?"i32":"i64";return[Number(t.getValue(s,l)),Number(t.getValue(s+n,l))]}finally{t.stackRestore(r)}},Ao=(e,t)=>{let r=ot(),n=r.stackSave(),s=0;try{let l=r.PTR_SIZE,a=r.stackAlloc(2*l);r._OrtGetInputOutputMetadata(e,t,a,a+l)!==0&&tt("Can't get session input/output metadata.");let d=Number(r.getValue(a,"*"));s=Number(r.getValue(a+l,"*"));let p=r.HEAP32[s/4];if(p===0)return[d,0];let c=r.HEAPU32[s/4+1],g=[];for(let _=0;_<c;_++){let w=Number(r.getValue(s+8+_*l,"*"));g.push(w!==0?r.UTF8ToString(w):Number(r.getValue(s+8+(_+c)*l,"*")))}return[d,p,g]}finally{r.stackRestore(n),s!==0&&r._OrtFree(s)}},kn=e=>{let t=ot(),r=t._malloc(e.byteLength);if(r===0)throw new Error(`Can't create a session. failed to allocate a buffer of size ${e.byteLength}.`);return t.HEAPU8.set(e,r),[r,e.byteLength]},va=async(e,t)=>{let r,n,s=ot();Array.isArray(e)?[r,n]=e:e.buffer===s.HEAPU8.buffer?[r,n]=[e.byteOffset,e.byteLength]:[r,n]=kn(e);let l=0,a=0,d=0,p=[],c=[],g=[];try{if([a,p]=await ah(t),t?.externalData&&s.mountExternalData){let L=[];for(let M of t.externalData){let F=typeof M=="string"?M:M.path,U=typeof M=="string"?M:M.data;L.push(na(U).then(k=>{s.mountExternalData(F,k)}))}await Promise.all(L)}for(let L of t?.executionProviders??[])if((typeof L=="string"?L:L.name)==="webnn"){if(s.shouldTransferToMLTensor=!1,typeof L!="string"){let M=L,F=M?.context,U=M?.gpuDevice,k=M?.deviceType,re=M?.powerPreference;F?s.currentContext=F:U?s.currentContext=await s.webnnCreateMLContext(U):s.currentContext=await s.webnnCreateMLContext({deviceType:k,powerPreference:re})}else s.currentContext=await s.webnnCreateMLContext();break}l=await s._OrtCreateSession(r,n,a),s.webgpuOnCreateSession?.(l),l===0&&tt("Can't create a session."),s.jsepOnCreateSession?.(),s.currentContext&&(s.webnnRegisterMLContext(l,s.currentContext),s.currentContext=void 0,s.shouldTransferToMLTensor=!0);let[_,w]=Of(l),C=!!t?.enableGraphCapture,x=[],S=[],N=[],E=[],T=[];for(let L=0;L<_;L++){let[M,F,U]=Ao(l,L);M===0&&tt("Can't get an input name."),c.push(M);let k=s.UTF8ToString(M);x.push(k),N.push(F===0?{name:k,isTensor:!1}:{name:k,isTensor:!0,type:vi(F),shape:U})}for(let L=0;L<w;L++){let[M,F,U]=Ao(l,L+_);M===0&&tt("Can't get an output name."),g.push(M);let k=s.UTF8ToString(M);S.push(k),E.push(F===0?{name:k,isTensor:!1}:{name:k,isTensor:!0,type:vi(F),shape:U});{if(C&&t?.preferredOutputLocation===void 0){T.push("gpu-buffer");continue}let re=typeof t?.preferredOutputLocation=="string"?t.preferredOutputLocation:t?.preferredOutputLocation?.[k]??"cpu",oe=s.webnnIsGraphOutput;if(re==="cpu"&&oe&&oe(l,k)){T.push("ml-tensor-cpu-output");continue}if(re!=="cpu"&&re!=="cpu-pinned"&&re!=="gpu-buffer"&&re!=="ml-tensor")throw new Error(`Not supported preferred output location: ${re}.`);if(C&&re!=="gpu-buffer")throw new Error(`Not supported preferred output location: ${re}. Only 'gpu-buffer' location is supported when enableGraphCapture is true.`);T.push(re)}}let B=null;return T.some(L=>L==="gpu-buffer"||L==="ml-tensor"||L==="ml-tensor-cpu-output")&&(d=s._OrtCreateBinding(l),d===0&&tt("Can't create IO binding."),B={handle:d,outputPreferredLocations:T,outputPreferredLocationsEncoded:T.map(L=>L==="ml-tensor-cpu-output"?"ml-tensor":L).map(L=>Lo(L))}),Ei.set(l,[l,c,g,B,C,!1]),[l,x,S,N,E]}catch(_){throw c.forEach(w=>s._OrtFree(w)),g.forEach(w=>s._OrtFree(w)),d!==0&&s._OrtReleaseBinding(d)!==0&&tt("Can't release IO binding."),l!==0&&s._OrtReleaseSession(l)!==0&&tt("Can't release session."),_}finally{s._free(r),a!==0&&s._OrtReleaseSessionOptions(a)!==0&&tt("Can't release session options."),p.forEach(_=>s._free(_)),s.unmountExternalData?.()}},wa=e=>{let t=ot(),r=Ei.get(e);if(!r)throw new Error(`cannot release session. invalid session id: ${e}`);let[n,s,l,a,d]=r;a&&(d&&t._OrtClearBoundOutputs(a.handle)!==0&&tt("Can't clear bound outputs."),t._OrtReleaseBinding(a.handle)!==0&&tt("Can't release IO binding.")),t.jsepOnReleaseSession?.(e),t.webnnOnReleaseSession?.(e),t.webgpuOnReleaseSession?.(e),s.forEach(p=>t._OrtFree(p)),l.forEach(p=>t._OrtFree(p)),t._OrtReleaseSession(n)!==0&&tt("Can't release session."),Ei.delete(e)},Oo=async(e,t,r,n,s,l,a=!1)=>{if(!e){t.push(0);return}let d=ot(),p=d.PTR_SIZE,c=e[0],g=e[1],_=e[3],w=_,C,x;if(c==="string"&&(_==="gpu-buffer"||_==="ml-tensor"))throw new Error("String tensor is not supported on GPU.");if(a&&_!=="gpu-buffer")throw new Error(`External buffer must be provided for input/output index ${l} when enableGraphCapture is true.`);if(_==="gpu-buffer"){let E=e[2].gpuBuffer;x=ji(Vi(c),g);{let T=d.jsepRegisterBuffer;if(!T)throw new Error('Tensor location "gpu-buffer" is not supported without using WebGPU.');C=T(n,l,E,x)}}else if(_==="ml-tensor"){let E=e[2].mlTensor;x=ji(Vi(c),g);let T=d.webnnRegisterMLTensor;if(!T)throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');C=T(n,E,Vi(c),g)}else{let E=e[2];if(Array.isArray(E)){x=p*E.length,C=d._malloc(x),r.push(C);for(let T=0;T<E.length;T++){if(typeof E[T]!="string")throw new TypeError(`tensor data at index ${T} is not a string`);d.setValue(C+T*p,Jt(E[T],r),"*")}}else{let T=d.webnnIsGraphInput,B=d.webnnIsGraphOutput;if(c!=="string"&&T&&B){let L=d.UTF8ToString(s);if(T(n,L)||B(n,L)){let M=Vi(c);x=ji(M,g),w="ml-tensor";let F=d.webnnCreateTemporaryTensor,U=d.webnnUploadTensor;if(!F||!U)throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');let k=await F(n,M,g);U(k,new Uint8Array(E.buffer,E.byteOffset,E.byteLength)),C=k}else x=E.byteLength,C=d._malloc(x),r.push(C),d.HEAPU8.set(new Uint8Array(E.buffer,E.byteOffset,x),C)}else x=E.byteLength,C=d._malloc(x),r.push(C),d.HEAPU8.set(new Uint8Array(E.buffer,E.byteOffset,x),C)}}let S=d.stackSave(),N=d.stackAlloc(4*g.length);try{g.forEach((T,B)=>d.setValue(N+B*p,T,p===4?"i32":"i64"));let E=d._OrtCreateTensor(Vi(c),C,x,N,g.length,Lo(w));E===0&&tt(`Can't create tensor for input/output. session=${n}, index=${l}.`),t.push(E)}finally{d.stackRestore(S)}},ba=async(e,t,r,n,s,l)=>{let a=ot(),d=a.PTR_SIZE,p=Ei.get(e);if(!p)throw new Error(`cannot run inference. invalid session id: ${e}`);let c=p[0],g=p[1],_=p[2],w=p[3],C=p[4],x=p[5],S=t.length,N=n.length,E=0,T=[],B=[],L=[],M=[],F=[],U=a.stackSave(),k=a.stackAlloc(S*d),re=a.stackAlloc(S*d),oe=a.stackAlloc(N*d),ye=a.stackAlloc(N*d);try{[E,T]=oh(l),ki("wasm prepareInputOutputTensor");for(let q=0;q<S;q++)await Oo(r[q],B,M,e,g[t[q]],t[q],C);for(let q=0;q<N;q++)await Oo(s[q],L,M,e,_[n[q]],S+n[q],C);Ni("wasm prepareInputOutputTensor");for(let q=0;q<S;q++)a.setValue(k+q*d,B[q],"*"),a.setValue(re+q*d,g[t[q]],"*");for(let q=0;q<N;q++)a.setValue(oe+q*d,L[q],"*"),a.setValue(ye+q*d,_[n[q]],"*");if(w&&!x){let{handle:q,outputPreferredLocations:Y,outputPreferredLocationsEncoded:Ie}=w;if(g.length!==S)throw new Error(`input count from feeds (${S}) is expected to be always equal to model's input count (${g.length}).`);ki("wasm bindInputsOutputs");for(let Te=0;Te<S;Te++){let be=t[Te];await a._OrtBindInput(q,g[be],B[Te])!==0&&tt(`Can't bind input[${Te}] for session=${e}.`)}for(let Te=0;Te<N;Te++){let be=n[Te];s[Te]?.[3]?(F.push(L[Te]),a._OrtBindOutput(q,_[be],L[Te],0)!==0&&tt(`Can't bind pre-allocated output[${Te}] for session=${e}.`)):a._OrtBindOutput(q,_[be],0,Ie[be])!==0&&tt(`Can't bind output[${Te}] to ${Y[Te]} for session=${e}.`)}Ni("wasm bindInputsOutputs"),Ei.set(e,[c,g,_,w,C,!0])}a.jsepOnRunStart?.(c),a.webnnOnRunStart?.(c);let fe;w?fe=await a._OrtRunWithBinding(c,w.handle,N,oe,E):fe=await a._OrtRun(c,re,k,S,ye,N,oe,E),fe!==0&&tt("failed to call OrtRun().");let ce=[],$e=[];ki("wasm ProcessOutputTensor");for(let q=0;q<N;q++){let Y=Number(a.getValue(oe+q*d,"*"));if(Y===L[q]||F.includes(L[q])){ce.push(s[q]),Y!==L[q]&&a._OrtReleaseTensor(Y)!==0&&tt("Can't release tensor.");continue}let Ie=a.stackSave(),Te=a.stackAlloc(4*d),be=!1,ke,ne=0;try{a._OrtGetTensorData(Y,Te,Te+d,Te+2*d,Te+3*d)!==0&&tt(`Can't access output tensor data on index ${q}.`);let Se=d===4?"i32":"i64",ve=Number(a.getValue(Te,Se));ne=a.getValue(Te+d,"*");let me=a.getValue(Te+d*2,"*"),Ue=Number(a.getValue(Te+d*3,Se)),st=[];for(let Ge=0;Ge<Ue;Ge++)st.push(Number(a.getValue(me+Ge*d,Se)));a._OrtFree(me)!==0&&tt("Can't free memory for tensor dims.");let et=st.reduce((Ge,Be)=>Ge*Be,1);ke=vi(ve);let it=w?.outputPreferredLocations[n[q]];if(ke==="string"){if(it==="gpu-buffer"||it==="ml-tensor")throw new Error("String tensor is not supported on GPU.");let Ge=[];for(let Be=0;Be<et;Be++){let Je=a.getValue(ne+Be*d,"*"),_t=a.getValue(ne+(Be+1)*d,"*"),Xt=Be===et-1?void 0:_t-Je;Ge.push(a.UTF8ToString(Je,Xt))}ce.push([ke,st,Ge,"cpu"])}else if(it==="gpu-buffer"&&et>0){let Ge=a.jsepGetBuffer;if(!Ge)throw new Error('preferredLocation "gpu-buffer" is not supported without using WebGPU.');let Be=Ge(ne),Je=ji(ve,et);if(Je===void 0||!ia(ke))throw new Error(`Unsupported data type: ${ke}`);be=!0,ce.push([ke,st,{gpuBuffer:Be,download:a.jsepCreateDownloader(Be,Je,ke),dispose:()=>{a._OrtReleaseTensor(Y)!==0&&tt("Can't release tensor.")}},"gpu-buffer"])}else if(it==="ml-tensor"&&et>0){let Ge=a.webnnEnsureTensor,Be=a.webnnIsGraphInputOutputTypeSupported;if(!Ge||!Be)throw new Error('preferredLocation "ml-tensor" is not supported without using WebNN.');if(ji(ve,et)===void 0||!ra(ke))throw new Error(`Unsupported data type: ${ke}`);if(!Be(e,ke,!1))throw new Error(`preferredLocation "ml-tensor" for ${ke} output is not supported by current WebNN Context.`);let Je=await Ge(e,ne,ve,st,!1);be=!0,ce.push([ke,st,{mlTensor:Je,download:a.webnnCreateMLTensorDownloader(ne,ke),dispose:()=>{a.webnnReleaseTensorId(ne),a._OrtReleaseTensor(Y)}},"ml-tensor"])}else if(it==="ml-tensor-cpu-output"&&et>0){let Ge=a.webnnCreateMLTensorDownloader(ne,ke)(),Be=ce.length;be=!0,$e.push((async()=>{let Je=[Be,await Ge];return a.webnnReleaseTensorId(ne),a._OrtReleaseTensor(Y),Je})()),ce.push([ke,st,[],"cpu"])}else{let Ge=Nn(ke),Be=new Ge(et);new Uint8Array(Be.buffer,Be.byteOffset,Be.byteLength).set(a.HEAPU8.subarray(ne,ne+Be.byteLength)),ce.push([ke,st,Be,"cpu"])}}finally{a.stackRestore(Ie),ke==="string"&&ne&&a._free(ne),be||a._OrtReleaseTensor(Y)}}w&&!C&&(a._OrtClearBoundOutputs(w.handle)!==0&&tt("Can't clear bound outputs."),Ei.set(e,[c,g,_,w,C,!1]));for(let[q,Y]of await Promise.all($e))ce[q][2]=Y;return Ni("wasm ProcessOutputTensor"),ce}finally{a.webnnOnRunEnd?.(c),a.stackRestore(U),B.forEach(fe=>a._OrtReleaseTensor(fe)),L.forEach(fe=>a._OrtReleaseTensor(fe)),M.forEach(fe=>a._free(fe)),E!==0&&a._OrtReleaseRunOptions(E),T.forEach(fe=>a._free(fe))}},xa=e=>{let t=ot(),r=Ei.get(e);if(!r)throw new Error("invalid session id");let n=r[0],s=t._OrtEndProfiling(n);s===0&&tt("Can't get an profile file name."),t._OrtFree(s)},$a=e=>{let t=[];for(let r of e){let n=r[2];!Array.isArray(n)&&"buffer"in n&&t.push(n.buffer)}return t}}),g0=de(()=>{"use strict";Wt(),l0(),er(),Qo(),Ai=()=>!!lt.wasm.proxy&&typeof document<"u",sr=!1,Pr=!1,Er=!1,$n=new Map,Yi=(e,t)=>{let r=$n.get(e);r?r.push(t):$n.set(e,[t])},Gi=()=>{if(sr||!Pr||Er||!Ut)throw new Error("worker not ready")},kf=e=>{switch(e.data.type){case"init-wasm":sr=!1,e.data.err?(Er=!0,ko[1](e.data.err)):(Pr=!0,ko[0]()),xn&&(URL.revokeObjectURL(xn),xn=void 0);break;case"init-ep":case"copy-from":case"create":case"release":case"run":case"end-profiling":{let t=$n.get(e.data.type);e.data.err?t.shift()[1](e.data.err):t.shift()[0](e.data.out);break}default:}},u0=async()=>{if(!Pr){if(sr)throw new Error("multiple calls to 'initWasm()' detected.");if(Er)throw new Error("previous call to 'initWasm()' failed.");if(sr=!0,Ai())return new Promise((e,t)=>{Ut?.terminate(),nh().then(([r,n])=>{try{Ut=n,Ut.onerror=l=>t(l),Ut.onmessage=kf,ko=[e,t];let s={type:"init-wasm",in:lt};!s.in.wasm.wasmPaths&&(r||Bo)&&(s.in.wasm.wasmPaths={wasm:new URL("ort-wasm-simd-threaded.jsep.wasm",Qt.url).href}),Ut.postMessage(s),xn=r}catch(s){t(s)}},t)});try{await ea(lt.wasm),await ya(lt),Pr=!0}catch(e){throw Er=!0,e}finally{sr=!1}}},d0=async e=>{if(Ai())return Gi(),new Promise((t,r)=>{Yi("init-ep",[t,r]);let n={type:"init-ep",in:{epName:e,env:lt}};Ut.postMessage(n)});await _a(lt,e)},p0=async e=>Ai()?(Gi(),new Promise((t,r)=>{Yi("copy-from",[t,r]);let n={type:"copy-from",in:{buffer:e}};Ut.postMessage(n,[e.buffer])})):kn(e),c0=async(e,t)=>{if(Ai()){if(t?.preferredOutputLocation)throw new Error('session option "preferredOutputLocation" is not supported for proxy.');return Gi(),new Promise((r,n)=>{Yi("create",[r,n]);let s={type:"create",in:{model:e,options:{...t}}},l=[];e instanceof Uint8Array&&l.push(e.buffer),Ut.postMessage(s,l)})}else return va(e,t)},f0=async e=>{if(Ai())return Gi(),new Promise((t,r)=>{Yi("release",[t,r]);let n={type:"release",in:e};Ut.postMessage(n)});wa(e)},h0=async(e,t,r,n,s,l)=>{if(Ai()){if(r.some(a=>a[3]!=="cpu"))throw new Error("input tensor on GPU is not supported for proxy.");if(s.some(a=>a))throw new Error("pre-allocated output tensor is not supported for proxy.");return Gi(),new Promise((a,d)=>{Yi("run",[a,d]);let p=r,c={type:"run",in:{sessionId:e,inputIndices:t,inputs:p,outputIndices:n,options:l}};Ut.postMessage(c,$a(p))})}else return ba(e,t,r,n,s,l)},m0=async e=>{if(Ai())return Gi(),new Promise((t,r)=>{Yi("end-profiling",[t,r]);let n={type:"end-profiling",in:e};Ut.postMessage(n)});xa(e)}}),tw=de(()=>{"use strict";Wt(),g0(),Oe(),Jo(),lh(),No=(e,t)=>{switch(e.location){case"cpu":return[e.type,e.dims,e.data,"cpu"];case"gpu-buffer":return[e.type,e.dims,{gpuBuffer:e.gpuBuffer},"gpu-buffer"];case"ml-tensor":return[e.type,e.dims,{mlTensor:e.mlTensor},"ml-tensor"];default:throw new Error(`invalid data location: ${e.location} for ${t()}`)}},Nf=e=>{switch(e[3]){case"cpu":return new ei(e[0],e[2],e[1]);case"gpu-buffer":{let t=e[0];if(!ia(t))throw new Error(`not supported data type: ${t} for deserializing GPU tensor`);let{gpuBuffer:r,download:n,dispose:s}=e[2];return ei.fromGpuBuffer(r,{dataType:t,dims:e[1],download:n,dispose:s})}case"ml-tensor":{let t=e[0];if(!ra(t))throw new Error(`not supported data type: ${t} for deserializing MLTensor tensor`);let{mlTensor:r,download:n,dispose:s}=e[2];return ei.fromMLTensor(r,{dataType:t,dims:e[1],download:n,dispose:s})}default:throw new Error(`invalid data location: ${e[3]}`)}},y0=class{async fetchModelAndCopyToWasmMemory(e){return p0(await na(e))}async loadModel(e,t){ti();let r;typeof e=="string"?r=await this.fetchModelAndCopyToWasmMemory(e):r=e,[this.sessionId,this.inputNames,this.outputNames,this.inputMetadata,this.outputMetadata]=await c0(r,t),qt()}async dispose(){return f0(this.sessionId)}async run(e,t,r){ti();let n=[],s=[];Object.entries(e).forEach(_=>{let w=_[0],C=_[1],x=this.inputNames.indexOf(w);if(x===-1)throw new Error(`invalid input '${w}'`);n.push(C),s.push(x)});let l=[],a=[];Object.entries(t).forEach(_=>{let w=_[0],C=_[1],x=this.outputNames.indexOf(w);if(x===-1)throw new Error(`invalid output '${w}'`);l.push(C),a.push(x)});let d=n.map((_,w)=>No(_,()=>`input "${this.inputNames[s[w]]}"`)),p=l.map((_,w)=>_?No(_,()=>`output "${this.outputNames[a[w]]}"`):null),c=await h0(this.sessionId,s,d,a,p,r),g={};for(let _=0;_<c.length;_++)g[this.outputNames[a[_]]]=l[_]??Nf(c[_]);return qt(),g}startProfiling(){}endProfiling(){m0(this.sessionId)}}}),_0={};ur(_0,{OnnxruntimeWebAssemblyBackend:()=>Vo,initializeFlags:()=>Ho,wasmBackend:()=>v0});iw=de(()=>{"use strict";Wt(),g0(),tw(),Ho=()=>{(typeof lt.wasm.initTimeout!="number"||lt.wasm.initTimeout<0)&&(lt.wasm.initTimeout=0);let e=lt.wasm.simd;if(typeof e!="boolean"&&e!==void 0&&e!=="fixed"&&e!=="relaxed"&&(console.warn(`Property "env.wasm.simd" is set to unknown value "${e}". Reset it to \`false\` and ignore SIMD feature checking.`),lt.wasm.simd=!1),typeof lt.wasm.proxy!="boolean"&&(lt.wasm.proxy=!1),typeof lt.wasm.trace!="boolean"&&(lt.wasm.trace=!1),typeof lt.wasm.numThreads!="number"||!Number.isInteger(lt.wasm.numThreads)||lt.wasm.numThreads<=0)if(typeof self<"u"&&!self.crossOriginIsolated)lt.wasm.numThreads=1;else{let t=typeof navigator>"u"?U_("node:os").cpus().length:navigator.hardwareConcurrency;lt.wasm.numThreads=Math.min(4,Math.ceil((t||1)/2))}},Vo=class{async init(e){Ho(),await u0(),await d0(e)}async createInferenceSessionHandler(e,t){let r=new y0;return await r.loadModel(e,t),r}},v0=new Vo});Wt();Wt();Wt();rw="1.30.0",nw=Jf;{let e=(iw(),Br(_0)).wasmBackend;Ki("webgpu",e,5),Ki("webnn",e,5),Ki("cpu",e,10),Ki("wasm",e,10)}Object.defineProperty(lt.versions,"web",{value:rw,enumerable:!0});});function k_(e){return e&&e.__esModule&&Object.prototype.hasOwnProperty.call(e,"default")?e.default:e}var bt={},an={},Ti={},nu;function yr(){if(nu)return Ti;nu=1;function e(a){return typeof a>"u"||a===null}function t(a){return typeof a=="object"&&a!==null}function r(a){return Array.isArray(a)?a:e(a)?[]:[a]}function n(a,d){if(d){let p=Object.keys(d);for(let c=0,g=p.length;c<g;c+=1){let _=p[c];a[_]=d[_]}}return a}function s(a,d){let p="";for(let c=0;c<d;c+=1)p+=a;return p}function l(a){return a===0&&Number.NEGATIVE_INFINITY===1/a}return Ti.isNothing=e,Ti.isObject=t,Ti.toArray=r,Ti.repeat=s,Ti.isNegativeZero=l,Ti.extend=n,Ti}var us,su;function _r(){if(su)return us;su=1;function e(r,n){let s="",l=r.reason||"(unknown reason)";return r.mark?(r.mark.name&&(s+='in "'+r.mark.name+'" '),s+="("+(r.mark.line+1)+":"+(r.mark.column+1)+")",!n&&r.mark.snippet&&(s+=`

`+r.mark.snippet),l+" "+s):l}function t(r,n){Error.call(this),this.name="YAMLException",this.reason=r,this.mark=n,this.message=e(this,!1),Error.captureStackTrace?Error.captureStackTrace(this,this.constructor):this.stack=new Error().stack||""}return t.prototype=Object.create(Error.prototype),t.prototype.constructor=t,t.prototype.toString=function(n){return this.name+": "+e(this,n)},us=t,us}var ds,ou;function N_(){if(ou)return ds;ou=1;let e=yr();function t(s,l,a,d,p){let c="",g="",_=Math.floor(p/2)-1;return d-l>_&&(c=" ... ",l=d-_+c.length),a-d>_&&(g=" ...",a=d+_-g.length),{str:c+s.slice(l,a).replace(/\t/g,"\u2192")+g,pos:d-l+c.length}}function r(s,l){return e.repeat(" ",l-s.length)+s}function n(s,l){if(l=Object.create(l||null),!s.buffer)return null;l.maxLength||(l.maxLength=79),typeof l.indent!="number"&&(l.indent=1),typeof l.linesBefore!="number"&&(l.linesBefore=3),typeof l.linesAfter!="number"&&(l.linesAfter=2);let a=/\r?\n|\r|\0/g,d=[0],p=[],c,g=-1;for(;c=a.exec(s.buffer);)p.push(c.index),d.push(c.index+c[0].length),s.position<=c.index&&g<0&&(g=d.length-2);g<0&&(g=d.length-1);let _="",w=Math.min(s.line+l.linesAfter,p.length).toString().length,C=l.maxLength-(l.indent+w+3);for(let S=1;S<=l.linesBefore&&!(g-S<0);S++){let N=t(s.buffer,d[g-S],p[g-S],s.position-(d[g]-d[g-S]),C);_=e.repeat(" ",l.indent)+r((s.line-S+1).toString(),w)+" | "+N.str+`
`+_}let x=t(s.buffer,d[g],p[g],s.position,C);_+=e.repeat(" ",l.indent)+r((s.line+1).toString(),w)+" | "+x.str+`
`,_+=e.repeat("-",l.indent+w+3+x.pos)+`^
`;for(let S=1;S<=l.linesAfter&&!(g+S>=p.length);S++){let N=t(s.buffer,d[g+S],p[g+S],s.position-(d[g]-d[g+S]),C);_+=e.repeat(" ",l.indent)+r((s.line+S+1).toString(),w)+" | "+N.str+`
`}return _.replace(/\n$/,"")}return ds=n,ds}var ps,au;function Ct(){if(au)return ps;au=1;let e=_r(),t=["kind","multi","resolve","construct","instanceOf","predicate","represent","representName","defaultStyle","styleAliases"],r=["scalar","sequence","mapping"];function n(l){let a={};return l!==null&&Object.keys(l).forEach(function(d){l[d].forEach(function(p){a[String(p)]=d})}),a}function s(l,a){if(a=a||{},Object.keys(a).forEach(function(d){if(t.indexOf(d)===-1)throw new e('Unknown option "'+d+'" is met in definition of "'+l+'" YAML type.')}),this.options=a,this.tag=l,this.kind=a.kind||null,this.resolve=a.resolve||function(){return!0},this.construct=a.construct||function(d){return d},this.instanceOf=a.instanceOf||null,this.predicate=a.predicate||null,this.represent=a.represent||null,this.representName=a.representName||null,this.defaultStyle=a.defaultStyle||null,this.multi=a.multi||!1,this.styleAliases=n(a.styleAliases||null),r.indexOf(this.kind)===-1)throw new e('Unknown kind "'+this.kind+'" is specified for "'+l+'" YAML type.')}return ps=s,ps}var cs,lu;function Eu(){if(lu)return cs;lu=1;let e=_r(),t=Ct();function r(l,a){let d=[];return l[a].forEach(function(p){let c=d.length;d.forEach(function(g,_){g.tag===p.tag&&g.kind===p.kind&&g.multi===p.multi&&(c=_)}),d[c]=p}),d}function n(){let l={scalar:{},sequence:{},mapping:{},fallback:{},multi:{scalar:[],sequence:[],mapping:[],fallback:[]}};function a(d){d.multi?(l.multi[d.kind].push(d),l.multi.fallback.push(d)):l[d.kind][d.tag]=l.fallback[d.tag]=d}for(let d=0,p=arguments.length;d<p;d+=1)arguments[d].forEach(a);return l}function s(l){return this.extend(l)}return s.prototype.extend=function(a){let d=[],p=[];if(a instanceof t)p.push(a);else if(Array.isArray(a))p=p.concat(a);else if(a&&(Array.isArray(a.implicit)||Array.isArray(a.explicit)))a.implicit&&(d=d.concat(a.implicit)),a.explicit&&(p=p.concat(a.explicit));else throw new e("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");d.forEach(function(g){if(!(g instanceof t))throw new e("Specified list of YAML types (or a single Type object) contains a non-Type object.");if(g.loadKind&&g.loadKind!=="scalar")throw new e("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");if(g.multi)throw new e("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.")}),p.forEach(function(g){if(!(g instanceof t))throw new e("Specified list of YAML types (or a single Type object) contains a non-Type object.")});let c=Object.create(s.prototype);return c.implicit=(this.implicit||[]).concat(d),c.explicit=(this.explicit||[]).concat(p),c.compiledImplicit=r(c,"implicit"),c.compiledExplicit=r(c,"explicit"),c.compiledTypeMap=n(c.compiledImplicit,c.compiledExplicit),c},cs=s,cs}var fs,uu;function Au(){if(uu)return fs;uu=1;let e=Ct();return fs=new e("tag:yaml.org,2002:str",{kind:"scalar",construct:function(t){return t!==null?t:""}}),fs}var hs,du;function Ou(){if(du)return hs;du=1;let e=Ct();return hs=new e("tag:yaml.org,2002:seq",{kind:"sequence",construct:function(t){return t!==null?t:[]}}),hs}var ms,pu;function ku(){if(pu)return ms;pu=1;let e=Ct();return ms=new e("tag:yaml.org,2002:map",{kind:"mapping",construct:function(t){return t!==null?t:{}}}),ms}var gs,cu;function Nu(){if(cu)return gs;cu=1;let e=Eu();return gs=new e({explicit:[Au(),Ou(),ku()]}),gs}var ys,fu;function Bu(){if(fu)return ys;fu=1;let e=Ct();function t(s){if(s===null)return!0;let l=s.length;return l===1&&s==="~"||l===4&&(s==="null"||s==="Null"||s==="NULL")}function r(){return null}function n(s){return s===null}return ys=new e("tag:yaml.org,2002:null",{kind:"scalar",resolve:t,construct:r,predicate:n,represent:{canonical:function(){return"~"},lowercase:function(){return"null"},uppercase:function(){return"NULL"},camelcase:function(){return"Null"},empty:function(){return""}},defaultStyle:"lowercase"}),ys}var _s,hu;function Lu(){if(hu)return _s;hu=1;let e=Ct();function t(s){if(s===null)return!1;let l=s.length;return l===4&&(s==="true"||s==="True"||s==="TRUE")||l===5&&(s==="false"||s==="False"||s==="FALSE")}function r(s){return s==="true"||s==="True"||s==="TRUE"}function n(s){return Object.prototype.toString.call(s)==="[object Boolean]"}return _s=new e("tag:yaml.org,2002:bool",{kind:"scalar",resolve:t,construct:r,predicate:n,represent:{lowercase:function(s){return s?"true":"false"},uppercase:function(s){return s?"TRUE":"FALSE"},camelcase:function(s){return s?"True":"False"}},defaultStyle:"lowercase"}),_s}var vs,mu;function Mu(){if(mu)return vs;mu=1;let e=yr(),t=Ct();function r(c){return c>=48&&c<=57||c>=65&&c<=70||c>=97&&c<=102}function n(c){return c>=48&&c<=55}function s(c){return c>=48&&c<=57}function l(c){if(c===null)return!1;let g=c.length,_=0,w=!1;if(!g)return!1;let C=c[_];if((C==="-"||C==="+")&&(C=c[++_]),C==="0"){if(_+1===g)return!0;if(C=c[++_],C==="b"){for(_++;_<g;_++){if(C=c[_],C!=="0"&&C!=="1")return!1;w=!0}return w&&isFinite(a(c))}if(C==="x"){for(_++;_<g;_++){if(!r(c.charCodeAt(_)))return!1;w=!0}return w&&isFinite(a(c))}if(C==="o"){for(_++;_<g;_++){if(!n(c.charCodeAt(_)))return!1;w=!0}return w&&isFinite(a(c))}}for(;_<g;_++){if(!s(c.charCodeAt(_)))return!1;w=!0}return w?isFinite(a(c)):!1}function a(c){let g=c,_=1,w=g[0];if((w==="-"||w==="+")&&(w==="-"&&(_=-1),g=g.slice(1),w=g[0]),g==="0")return 0;if(w==="0"){if(g[1]==="b")return _*parseInt(g.slice(2),2);if(g[1]==="x")return _*parseInt(g.slice(2),16);if(g[1]==="o")return _*parseInt(g.slice(2),8)}return _*parseInt(g,10)}function d(c){return a(c)}function p(c){return Object.prototype.toString.call(c)==="[object Number]"&&c%1===0&&!e.isNegativeZero(c)}return vs=new t("tag:yaml.org,2002:int",{kind:"scalar",resolve:l,construct:d,predicate:p,represent:{binary:function(c){return c>=0?"0b"+c.toString(2):"-0b"+c.toString(2).slice(1)},octal:function(c){return c>=0?"0o"+c.toString(8):"-0o"+c.toString(8).slice(1)},decimal:function(c){return c.toString(10)},hexadecimal:function(c){return c>=0?"0x"+c.toString(16).toUpperCase():"-0x"+c.toString(16).toUpperCase().slice(1)}},defaultStyle:"decimal",styleAliases:{binary:[2,"bin"],octal:[8,"oct"],decimal:[10,"dec"],hexadecimal:[16,"hex"]}}),vs}var ws,gu;function Ru(){if(gu)return ws;gu=1;let e=yr(),t=Ct(),r=new RegExp("^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"),n=new RegExp("^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");function s(c){return c===null||!r.test(c)?!1:isFinite(parseFloat(c,10))?!0:n.test(c)}function l(c){let g=c.toLowerCase(),_=g[0]==="-"?-1:1;return"+-".indexOf(g[0])>=0&&(g=g.slice(1)),g===".inf"?_===1?Number.POSITIVE_INFINITY:Number.NEGATIVE_INFINITY:g===".nan"?NaN:_*parseFloat(g,10)}let a=/^[-+]?[0-9]+e/;function d(c,g){if(isNaN(c))switch(g){case"lowercase":return".nan";case"uppercase":return".NAN";case"camelcase":return".NaN"}else if(Number.POSITIVE_INFINITY===c)switch(g){case"lowercase":return".inf";case"uppercase":return".INF";case"camelcase":return".Inf"}else if(Number.NEGATIVE_INFINITY===c)switch(g){case"lowercase":return"-.inf";case"uppercase":return"-.INF";case"camelcase":return"-.Inf"}else if(e.isNegativeZero(c))return"-0.0";let _=c.toString(10);return a.test(_)?_.replace("e",".e"):_}function p(c){return Object.prototype.toString.call(c)==="[object Number]"&&(c%1!==0||e.isNegativeZero(c))}return ws=new t("tag:yaml.org,2002:float",{kind:"scalar",resolve:s,construct:l,predicate:p,represent:d,defaultStyle:"lowercase"}),ws}var bs,yu;function Du(){return yu||(yu=1,bs=Nu().extend({implicit:[Bu(),Lu(),Mu(),Ru()]})),bs}var xs,_u;function zu(){return _u||(_u=1,xs=Du()),xs}var $s,vu;function Fu(){if(vu)return $s;vu=1;let e=Ct(),t=new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"),r=new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$");function n(a){return a===null?!1:t.exec(a)!==null||r.exec(a)!==null}function s(a){let d=0,p=null,c=t.exec(a);if(c===null&&(c=r.exec(a)),c===null)throw new Error("Date resolve error");let g=+c[1],_=+c[2]-1,w=+c[3];if(!c[4])return new Date(Date.UTC(g,_,w));let C=+c[4],x=+c[5],S=+c[6];if(c[7]){for(d=c[7].slice(0,3);d.length<3;)d+="0";d=+d}if(c[9]){let E=+c[10],T=+(c[11]||0);p=(E*60+T)*6e4,c[9]==="-"&&(p=-p)}let N=new Date(Date.UTC(g,_,w,C,x,S,d));return p&&N.setTime(N.getTime()-p),N}function l(a){return a.toISOString()}return $s=new e("tag:yaml.org,2002:timestamp",{kind:"scalar",resolve:n,construct:s,instanceOf:Date,represent:l}),$s}var Cs,wu;function Uu(){if(wu)return Cs;wu=1;let e=Ct();function t(r){return r==="<<"||r===null}return Cs=new e("tag:yaml.org,2002:merge",{kind:"scalar",resolve:t}),Cs}var Is,bu;function qu(){if(bu)return Is;bu=1;let e=Ct(),t=`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=
\r`;function r(a){if(a===null)return!1;let d=0,p=a.length,c=t;for(let g=0;g<p;g++){let _=c.indexOf(a.charAt(g));if(!(_>64)){if(_<0)return!1;d+=6}}return d%8===0}function n(a){let d=a.replace(/[\r\n=]/g,""),p=d.length,c=t,g=0,_=[];for(let C=0;C<p;C++)C%4===0&&C&&(_.push(g>>16&255),_.push(g>>8&255),_.push(g&255)),g=g<<6|c.indexOf(d.charAt(C));let w=p%4*6;return w===0?(_.push(g>>16&255),_.push(g>>8&255),_.push(g&255)):w===18?(_.push(g>>10&255),_.push(g>>2&255)):w===12&&_.push(g>>4&255),new Uint8Array(_)}function s(a){let d="",p=0,c=a.length,g=t;for(let w=0;w<c;w++)w%3===0&&w&&(d+=g[p>>18&63],d+=g[p>>12&63],d+=g[p>>6&63],d+=g[p&63]),p=(p<<8)+a[w];let _=c%3;return _===0?(d+=g[p>>18&63],d+=g[p>>12&63],d+=g[p>>6&63],d+=g[p&63]):_===2?(d+=g[p>>10&63],d+=g[p>>4&63],d+=g[p<<2&63],d+=g[64]):_===1&&(d+=g[p>>2&63],d+=g[p<<4&63],d+=g[64],d+=g[64]),d}function l(a){return Object.prototype.toString.call(a)==="[object Uint8Array]"}return Is=new e("tag:yaml.org,2002:binary",{kind:"scalar",resolve:r,construct:n,predicate:l,represent:s}),Is}var Ts,xu;function Wu(){if(xu)return Ts;xu=1;let e=Ct(),t=Object.prototype.hasOwnProperty,r=Object.prototype.toString;function n(l){if(l===null)return!0;let a={},d=l;for(let p=0,c=d.length;p<c;p+=1){let g=d[p],_=!1;if(r.call(g)!=="[object Object]")return!1;let w;for(w in g)if(t.call(g,w))if(!_)_=!0;else return!1;if(!_||t.call(a,w))return!1;Object.defineProperty(a,w,{value:!0})}return!0}function s(l){return l!==null?l:[]}return Ts=new e("tag:yaml.org,2002:omap",{kind:"sequence",resolve:n,construct:s}),Ts}var Ss,$u;function Xu(){if($u)return Ss;$u=1;let e=Ct(),t=Object.prototype.toString;function r(s){if(s===null)return!0;let l=s,a=new Array(l.length);for(let d=0,p=l.length;d<p;d+=1){let c=l[d];if(t.call(c)!=="[object Object]")return!1;let g=Object.keys(c);if(g.length!==1)return!1;a[d]=[g[0],c[g[0]]]}return!0}function n(s){if(s===null)return[];let l=s,a=new Array(l.length);for(let d=0,p=l.length;d<p;d+=1){let c=l[d],g=Object.keys(c);a[d]=[g[0],c[g[0]]]}return a}return Ss=new e("tag:yaml.org,2002:pairs",{kind:"sequence",resolve:r,construct:n}),Ss}var Ps,Cu;function Yu(){if(Cu)return Ps;Cu=1;let e=Ct(),t=Object.prototype.hasOwnProperty;function r(s){if(s===null)return!0;let l=s;for(let a in l)if(t.call(l,a)&&l[a]!==null)return!1;return!0}function n(s){return s!==null?s:{}}return Ps=new e("tag:yaml.org,2002:set",{kind:"mapping",resolve:r,construct:n}),Ps}var Es,Iu;function Os(){return Iu||(Iu=1,Es=zu().extend({implicit:[Fu(),Uu()],explicit:[qu(),Wu(),Xu(),Yu()]})),Es}var Tu;function B_(){if(Tu)return an;Tu=1;let e=yr(),t=_r(),r=N_(),n=Os(),s=Object.prototype.hasOwnProperty,l=1,a=2,d=3,p=4,c=1,g=2,_=3,w=/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/,C=/[\x85\u2028\u2029]/,x=/[,\[\]{}]/,S=/^(?:!|!!|![0-9A-Za-z-]+!)$/,N=/^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;function E(m){return Object.prototype.toString.call(m)}function T(m){return m===10||m===13}function B(m){return m===9||m===32}function L(m){return m===9||m===32||m===10||m===13}function M(m){return m===44||m===91||m===93||m===123||m===125}function F(m){if(m>=48&&m<=57)return m-48;let W=m|32;return W>=97&&W<=102?W-97+10:-1}function U(m){return m===120?2:m===117?4:m===85?8:0}function k(m){return m>=48&&m<=57?m-48:-1}function re(m){switch(m){case 48:return"\0";case 97:return"\x07";case 98:return"\b";case 116:return"	";case 9:return"	";case 110:return`
`;case 118:return"\v";case 102:return"\f";case 114:return"\r";case 101:return"\x1B";case 32:return" ";case 34:return'"';case 47:return"/";case 92:return"\\";case 78:return"\x85";case 95:return"\xA0";case 76:return"\u2028";case 80:return"\u2029";default:return""}}function oe(m){return m<=65535?String.fromCharCode(m):String.fromCharCode((m-65536>>10)+55296,(m-65536&1023)+56320)}function ye(m,W,ie){W==="__proto__"?Object.defineProperty(m,W,{configurable:!0,enumerable:!0,writable:!0,value:ie}):m[W]=ie}let fe=new Array(256),ce=new Array(256);for(let m=0;m<256;m++)fe[m]=re(m)?1:0,ce[m]=re(m);function $e(m,W){this.input=m,this.filename=W.filename||null,this.schema=W.schema||n,this.onWarning=W.onWarning||null,this.legacy=W.legacy||!1,this.json=W.json||!1,this.listener=W.listener||null,this.maxDepth=typeof W.maxDepth=="number"?W.maxDepth:100,this.maxTotalMergeKeys=typeof W.maxTotalMergeKeys=="number"?W.maxTotalMergeKeys:1e4,this.implicitTypes=this.schema.compiledImplicit,this.typeMap=this.schema.compiledTypeMap,this.length=m.length,this.position=0,this.line=0,this.lineStart=0,this.lineIndent=0,this.depth=0,this.totalMergeKeys=0,this.firstTabInLine=-1,this.documents=[],this.anchorMapTransactions=[]}function q(m,W){let ie={name:m.filename,buffer:m.input.slice(0,-1),position:m.position,line:m.line,column:m.position-m.lineStart};return ie.snippet=r(ie),new t(W,ie)}function Y(m,W){throw q(m,W)}function Ie(m,W){m.onWarning&&m.onWarning.call(null,q(m,W))}function Te(m,W,ie){let ee=m.anchorMapTransactions;if(ee.length!==0){let K=ee[ee.length-1];s.call(K,W)||(K[W]={existed:s.call(m.anchorMap,W),value:m.anchorMap[W]})}m.anchorMap[W]=ie}function be(m){m.anchorMapTransactions.push(Object.create(null))}function ke(m){let W=m.anchorMapTransactions.pop(),ie=m.anchorMapTransactions;if(ie.length===0)return;let ee=ie[ie.length-1],K=Object.keys(W);for(let P=0,G=K.length;P<G;P+=1){let j=K[P];s.call(ee,j)||(ee[j]=W[j])}}function ne(m){let W=m.anchorMapTransactions.pop(),ie=Object.keys(W);for(let ee=ie.length-1;ee>=0;ee-=1){let K=W[ie[ee]];K.existed?m.anchorMap[ie[ee]]=K.value:delete m.anchorMap[ie[ee]]}}function Se(m){return{position:m.position,line:m.line,lineStart:m.lineStart,lineIndent:m.lineIndent,firstTabInLine:m.firstTabInLine,tag:m.tag,anchor:m.anchor,kind:m.kind,result:m.result}}function ve(m,W){m.position=W.position,m.line=W.line,m.lineStart=W.lineStart,m.lineIndent=W.lineIndent,m.firstTabInLine=W.firstTabInLine,m.tag=W.tag,m.anchor=W.anchor,m.kind=W.kind,m.result=W.result}let me={YAML:function(W,ie,ee){W.version!==null&&Y(W,"duplication of %YAML directive"),ee.length!==1&&Y(W,"YAML directive accepts exactly one argument");let K=/^([0-9]+)\.([0-9]+)$/.exec(ee[0]);K===null&&Y(W,"ill-formed argument of the YAML directive");let P=parseInt(K[1],10),G=parseInt(K[2],10);P!==1&&Y(W,"unacceptable YAML version of the document"),W.version=ee[0],W.checkLineBreaks=G<2,G!==1&&G!==2&&Ie(W,"unsupported YAML version of the document")},TAG:function(W,ie,ee){let K;ee.length!==2&&Y(W,"TAG directive accepts exactly two arguments");let P=ee[0];K=ee[1],S.test(P)||Y(W,"ill-formed tag handle (first argument) of the TAG directive"),s.call(W.tagMap,P)&&Y(W,'there is a previously declared suffix for "'+P+'" tag handle'),N.test(K)||Y(W,"ill-formed tag prefix (second argument) of the TAG directive");try{K=decodeURIComponent(K)}catch{Y(W,"tag prefix is malformed: "+K)}W.tagMap[P]=K}};function Ue(m,W,ie,ee){if(W<ie){let K=m.input.slice(W,ie);if(ee)for(let P=0,G=K.length;P<G;P+=1){let j=K.charCodeAt(P);j===9||j>=32&&j<=1114111||Y(m,"expected valid JSON character")}else w.test(K)&&Y(m,"the stream contains non-printable characters");m.result+=K}}function st(m){m.totalMergeKeys++,m.maxTotalMergeKeys!==-1&&m.totalMergeKeys>m.maxTotalMergeKeys&&Y(m,"merge keys exceeded maxTotalMergeKeys ("+m.maxTotalMergeKeys+")")}function et(m,W,ie,ee){e.isObject(ie)||Y(m,"cannot merge mappings; the provided source object is unacceptable"),st(m);let K=Object.keys(ie);for(let P=0,G=K.length;P<G;P+=1){let j=K[P];st(m),s.call(W,j)||(ye(W,j,ie[j]),ee[j]=!0)}}function it(m,W,ie,ee,K,P,G,j,se){if(Array.isArray(K)){K=Array.prototype.slice.call(K);for(let le=0,ue=K.length;le<ue;le+=1)Array.isArray(K[le])&&Y(m,"nested arrays are not supported inside keys"),typeof K=="object"&&E(K[le])==="[object Object]"&&(K[le]="[object Object]")}if(typeof K=="object"&&E(K)==="[object Object]"&&(K="[object Object]"),K=String(K),W===null&&(W={}),ee==="tag:yaml.org,2002:merge")if(Array.isArray(P)){P.length>100&&Y(m,"abnormal merge sequence size");for(let le=0,ue=P.length;le<ue;le+=1)et(m,W,P[le],ie)}else et(m,W,P,ie);else!m.json&&!s.call(ie,K)&&s.call(W,K)&&(m.line=G||m.line,m.lineStart=j||m.lineStart,m.position=se||m.position,Y(m,"duplicated mapping key")),ye(W,K,P),delete ie[K];return W}function Ge(m){let W=m.input.charCodeAt(m.position);W===10?m.position++:W===13?(m.position++,m.input.charCodeAt(m.position)===10&&m.position++):Y(m,"a line break is expected"),m.line+=1,m.lineStart=m.position,m.firstTabInLine=-1}function Be(m,W,ie){let ee=0,K=m.input.charCodeAt(m.position);for(;K!==0;){for(;B(K);)K===9&&m.firstTabInLine===-1&&(m.firstTabInLine=m.position),K=m.input.charCodeAt(++m.position);if(W&&K===35)do K=m.input.charCodeAt(++m.position);while(K!==10&&K!==13&&K!==0);if(T(K))for(Ge(m),K=m.input.charCodeAt(m.position),ee++,m.lineIndent=0;K===32;)m.lineIndent++,K=m.input.charCodeAt(++m.position);else break}return ie!==-1&&ee!==0&&m.lineIndent<ie&&Ie(m,"deficient indentation"),ee}function Je(m){let W=m.position,ie=m.input.charCodeAt(W);return!!((ie===45||ie===46)&&ie===m.input.charCodeAt(W+1)&&ie===m.input.charCodeAt(W+2)&&(W+=3,ie=m.input.charCodeAt(W),ie===0||L(ie)))}function _t(m,W){W===1?m.result+=" ":W>1&&(m.result+=e.repeat(`
`,W-1))}function Xt(m,W,ie){let ee,K,P,G,j,se,le=m.kind,ue=m.result,Q=m.input.charCodeAt(m.position);if(L(Q)||M(Q)||Q===35||Q===38||Q===42||Q===33||Q===124||Q===62||Q===39||Q===34||Q===37||Q===64||Q===96)return!1;if(Q===63||Q===45){let pe=m.input.charCodeAt(m.position+1);if(L(pe)||ie&&M(pe))return!1}for(m.kind="scalar",m.result="",ee=K=m.position,P=!1;Q!==0;){if(Q===58){let pe=m.input.charCodeAt(m.position+1);if(L(pe)||ie&&M(pe))break}else if(Q===35){let pe=m.input.charCodeAt(m.position-1);if(L(pe))break}else{if(m.position===m.lineStart&&Je(m)||ie&&M(Q))break;if(T(Q))if(G=m.line,j=m.lineStart,se=m.lineIndent,Be(m,!1,-1),m.lineIndent>=W){P=!0,Q=m.input.charCodeAt(m.position);continue}else{m.position=K,m.line=G,m.lineStart=j,m.lineIndent=se;break}}P&&(Ue(m,ee,K,!1),_t(m,m.line-G),ee=K=m.position,P=!1),B(Q)||(K=m.position+1),Q=m.input.charCodeAt(++m.position)}return Ue(m,ee,K,!1),m.result?!0:(m.kind=le,m.result=ue,!1)}function vt(m,W){let ie,ee,K=m.input.charCodeAt(m.position);if(K!==39)return!1;for(m.kind="scalar",m.result="",m.position++,ie=ee=m.position;(K=m.input.charCodeAt(m.position))!==0;)if(K===39)if(Ue(m,ie,m.position,!0),K=m.input.charCodeAt(++m.position),K===39)ie=m.position,m.position++,ee=m.position;else return!0;else T(K)?(Ue(m,ie,ee,!0),_t(m,Be(m,!1,W)),ie=ee=m.position):m.position===m.lineStart&&Je(m)?Y(m,"unexpected end of the document within a single quoted scalar"):(m.position++,B(K)||(ee=m.position));Y(m,"unexpected end of the stream within a single quoted scalar")}function Qe(m,W){let ie,ee,K,P=m.input.charCodeAt(m.position);if(P!==34)return!1;for(m.kind="scalar",m.result="",m.position++,ie=ee=m.position;(P=m.input.charCodeAt(m.position))!==0;){if(P===34)return Ue(m,ie,m.position,!0),m.position++,!0;if(P===92){if(Ue(m,ie,m.position,!0),P=m.input.charCodeAt(++m.position),T(P))Be(m,!1,W);else if(P<256&&fe[P])m.result+=ce[P],m.position++;else if((K=U(P))>0){let G=K,j=0;for(;G>0;G--)P=m.input.charCodeAt(++m.position),(K=F(P))>=0?j=(j<<4)+K:Y(m,"expected hexadecimal character");m.result+=oe(j),m.position++}else Y(m,"unknown escape sequence");ie=ee=m.position}else T(P)?(Ue(m,ie,ee,!0),_t(m,Be(m,!1,W)),ie=ee=m.position):m.position===m.lineStart&&Je(m)?Y(m,"unexpected end of the document within a double quoted scalar"):(m.position++,B(P)||(ee=m.position))}Y(m,"unexpected end of the stream within a double quoted scalar")}function ri(m,W){let ie=!0,ee,K,P,G=m.tag,j,se=m.anchor,le,ue,Q,pe,xe=Object.create(null),Ee,Ae,Le,ze=m.input.charCodeAt(m.position);if(ze===91)le=93,pe=!1,j=[];else if(ze===123)le=125,pe=!0,j={};else return!1;for(m.anchor!==null&&Te(m,m.anchor,j),ze=m.input.charCodeAt(++m.position);ze!==0;){if(Be(m,!0,W),ze=m.input.charCodeAt(m.position),ze===le)return m.position++,m.tag=G,m.anchor=se,m.kind=pe?"mapping":"sequence",m.result=j,!0;if(ie?ze===44&&Y(m,"expected the node content, but found ','"):Y(m,"missed comma between flow collection entries"),Ae=Ee=Le=null,ue=Q=!1,ze===63){let kt=m.input.charCodeAt(m.position+1);L(kt)&&(ue=Q=!0,m.position++,Be(m,!0,W))}ee=m.line,K=m.lineStart,P=m.position,Ot(m,W,l,!1,!0),Ae=m.tag,Ee=m.result,Be(m,!0,W),ze=m.input.charCodeAt(m.position),(Q||m.line===ee)&&ze===58&&(ue=!0,ze=m.input.charCodeAt(++m.position),Be(m,!0,W),Ot(m,W,l,!1,!0),Le=m.result),pe?it(m,j,xe,Ae,Ee,Le,ee,K,P):ue?j.push(it(m,null,xe,Ae,Ee,Le,ee,K,P)):j.push(Ee),Be(m,!0,W),ze=m.input.charCodeAt(m.position),ze===44?(ie=!0,ze=m.input.charCodeAt(++m.position)):ie=!1}Y(m,"unexpected end of the stream within a flow collection")}function Et(m,W){let ie,ee=c,K=!1,P=!1,G=W,j=0,se=!1,le,ue=m.input.charCodeAt(m.position);if(ue===124)ie=!1;else if(ue===62)ie=!0;else return!1;for(m.kind="scalar",m.result="";ue!==0;)if(ue=m.input.charCodeAt(++m.position),ue===43||ue===45)c===ee?ee=ue===43?_:g:Y(m,"repeat of a chomping mode identifier");else if((le=k(ue))>=0)le===0?Y(m,"bad explicit indentation width of a block scalar; it cannot be less than one"):P?Y(m,"repeat of an indentation width identifier"):(G=W+le-1,P=!0);else break;if(B(ue)){do ue=m.input.charCodeAt(++m.position);while(B(ue));if(ue===35)do ue=m.input.charCodeAt(++m.position);while(!T(ue)&&ue!==0)}for(;ue!==0;){for(Ge(m),m.lineIndent=0,ue=m.input.charCodeAt(m.position);(!P||m.lineIndent<G)&&ue===32;)m.lineIndent++,ue=m.input.charCodeAt(++m.position);if(!P&&m.lineIndent>G&&(G=m.lineIndent),T(ue)){j++;continue}if(!P&&G===0&&Y(m,"missing indentation for block scalar"),m.lineIndent<G){ee===_?m.result+=e.repeat(`
`,K?1+j:j):ee===c&&K&&(m.result+=`
`);break}ie?B(ue)?(se=!0,m.result+=e.repeat(`
`,K?1+j:j)):se?(se=!1,m.result+=e.repeat(`
`,j+1)):j===0?K&&(m.result+=" "):m.result+=e.repeat(`
`,j):m.result+=e.repeat(`
`,K?1+j:j),K=!0,P=!0,j=0;let Q=m.position;for(;!T(ue)&&ue!==0;)ue=m.input.charCodeAt(++m.position);Ue(m,Q,m.position,!1)}return!0}function ni(m,W){let ie=m.tag,ee=m.anchor,K=[],P=!1;if(m.firstTabInLine!==-1)return!1;m.anchor!==null&&Te(m,m.anchor,K);let G=m.input.charCodeAt(m.position);for(;G!==0&&(m.firstTabInLine!==-1&&(m.position=m.firstTabInLine,Y(m,"tab characters must not be used in indentation")),G===45);){let j=m.input.charCodeAt(m.position+1);if(!L(j))break;if(P=!0,m.position++,Be(m,!0,-1)&&m.lineIndent<=W){K.push(null),G=m.input.charCodeAt(m.position);continue}let se=m.line;if(Ot(m,W,d,!1,!0),K.push(m.result),Be(m,!0,-1),G=m.input.charCodeAt(m.position),(m.line===se||m.lineIndent>W)&&G!==0)Y(m,"bad indentation of a sequence entry");else if(m.lineIndent<W)break}return P?(m.tag=ie,m.anchor=ee,m.kind="sequence",m.result=K,!0):!1}function xt(m,W,ie){let ee,K,P,G,j=m.tag,se=m.anchor,le={},ue=Object.create(null),Q=null,pe=null,xe=null,Ee=!1,Ae=!1;if(m.firstTabInLine!==-1)return!1;m.anchor!==null&&Te(m,m.anchor,le);let Le=m.input.charCodeAt(m.position);for(;Le!==0;){!Ee&&m.firstTabInLine!==-1&&(m.position=m.firstTabInLine,Y(m,"tab characters must not be used in indentation"));let ze=m.input.charCodeAt(m.position+1),kt=m.line;if((Le===63||Le===58)&&L(ze))Le===63?(Ee&&(it(m,le,ue,Q,pe,null,K,P,G),Q=pe=xe=null),Ae=!0,Ee=!0,ee=!0):Ee?(Ee=!1,ee=!0):Y(m,"incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line"),m.position+=1,Le=ze;else{if(K=m.line,P=m.lineStart,G=m.position,!Ot(m,ie,a,!1,!0))break;if(m.line===kt){for(Le=m.input.charCodeAt(m.position);B(Le);)Le=m.input.charCodeAt(++m.position);if(Le===58)Le=m.input.charCodeAt(++m.position),L(Le)||Y(m,"a whitespace character is expected after the key-value separator within a block mapping"),Ee&&(it(m,le,ue,Q,pe,null,K,P,G),Q=pe=xe=null),Ae=!0,Ee=!1,ee=!1,Q=m.tag,pe=m.result;else if(Ae)Y(m,"can not read an implicit mapping pair; a colon is missed");else return m.tag=j,m.anchor=se,!0}else if(Ae)Y(m,"can not read a block mapping entry; a multiline key may not be an implicit key");else return m.tag=j,m.anchor=se,!0}if((m.line===kt||m.lineIndent>W)&&(Ee&&(K=m.line,P=m.lineStart,G=m.position),Ot(m,W,p,!0,ee)&&(Ee?pe=m.result:xe=m.result),Ee||(it(m,le,ue,Q,pe,xe,K,P,G),Q=pe=xe=null),Be(m,!0,-1),Le=m.input.charCodeAt(m.position)),(m.line===kt||m.lineIndent>W)&&Le!==0)Y(m,"bad indentation of a mapping entry");else if(m.lineIndent<W)break}return Ee&&it(m,le,ue,Q,pe,null,K,P,G),Ae&&(m.tag=j,m.anchor=se,m.kind="mapping",m.result=le),Ae}function zt(m){let W=!1,ie=!1,ee,K,P=m.input.charCodeAt(m.position);if(P!==33)return!1;m.tag!==null&&Y(m,"duplication of a tag property"),P=m.input.charCodeAt(++m.position),P===60?(W=!0,P=m.input.charCodeAt(++m.position)):P===33?(ie=!0,ee="!!",P=m.input.charCodeAt(++m.position)):ee="!";let G=m.position;if(W){do P=m.input.charCodeAt(++m.position);while(P!==0&&P!==62);m.position<m.length?(K=m.input.slice(G,m.position),P=m.input.charCodeAt(++m.position)):Y(m,"unexpected end of the stream within a verbatim tag")}else{for(;P!==0&&!L(P);)P===33&&(ie?Y(m,"tag suffix cannot contain exclamation marks"):(ee=m.input.slice(G-1,m.position+1),S.test(ee)||Y(m,"named tag handle cannot contain such characters"),ie=!0,G=m.position+1)),P=m.input.charCodeAt(++m.position);K=m.input.slice(G,m.position),x.test(K)&&Y(m,"tag suffix cannot contain flow indicator characters")}K&&!N.test(K)&&Y(m,"tag name cannot contain such characters: "+K);try{K=decodeURIComponent(K)}catch{Y(m,"tag name is malformed: "+K)}return W?m.tag=K:s.call(m.tagMap,ee)?m.tag=m.tagMap[ee]+K:ee==="!"?m.tag="!"+K:ee==="!!"?m.tag="tag:yaml.org,2002:"+K:Y(m,'undeclared tag handle "'+ee+'"'),!0}function pi(m){let W=m.input.charCodeAt(m.position);if(W!==38)return!1;m.anchor!==null&&Y(m,"duplication of an anchor property"),W=m.input.charCodeAt(++m.position);let ie=m.position;for(;W!==0&&!L(W)&&!M(W);)W=m.input.charCodeAt(++m.position);return m.position===ie&&Y(m,"name of an anchor node must contain at least one character"),m.anchor=m.input.slice(ie,m.position),!0}function At(m){let W=m.input.charCodeAt(m.position);if(W!==42)return!1;W=m.input.charCodeAt(++m.position);let ie=m.position;for(;W!==0&&!L(W)&&!M(W);)W=m.input.charCodeAt(++m.position);m.position===ie&&Y(m,"name of an alias node must contain at least one character");let ee=m.input.slice(ie,m.position);return s.call(m.anchorMap,ee)||Y(m,'unidentified alias "'+ee+'"'),m.result=m.anchorMap[ee],Be(m,!0,-1),!0}function ci(m,W,ie,ee){let K=Se(m);return be(m),ve(m,W),m.tag=null,m.anchor=null,m.kind=null,m.result=null,xt(m,ie,ee)&&m.kind==="mapping"?(ke(m),!0):(ne(m),ve(m,K),!1)}function Ot(m,W,ie,ee,K){let P,G,j=1,se=!1,le=!1,ue=null,Q,pe,xe;m.depth>=m.maxDepth&&Y(m,"nesting exceeded maxDepth ("+m.maxDepth+")"),m.depth+=1,m.listener!==null&&m.listener("open",m),m.tag=null,m.anchor=null,m.kind=null,m.result=null;let Ee=P=G=p===ie||d===ie;if(ee&&Be(m,!0,-1)&&(se=!0,m.lineIndent>W?j=1:m.lineIndent===W?j=0:m.lineIndent<W&&(j=-1)),j===1)for(;;){let Ae=m.input.charCodeAt(m.position),Le=Se(m);if(se&&(Ae===33&&m.tag!==null||Ae===38&&m.anchor!==null)||!zt(m)&&!pi(m))break;ue===null&&(ue=Le),Be(m,!0,-1)?(se=!0,G=Ee,m.lineIndent>W?j=1:m.lineIndent===W?j=0:m.lineIndent<W&&(j=-1)):G=!1}if(G&&(G=se||K),j===1||p===ie)if(l===ie||a===ie?pe=W:pe=W+1,xe=m.position-m.lineStart,j===1)if(G&&(ni(m,xe)||xt(m,xe,pe))||ri(m,pe))le=!0;else{let Ae=m.input.charCodeAt(m.position);ue!==null&&Ee&&!G&&Ae!==124&&Ae!==62&&ci(m,ue,ue.position-ue.lineStart,pe)||P&&Et(m,pe)||vt(m,pe)||Qe(m,pe)?le=!0:At(m)?(le=!0,(m.tag!==null||m.anchor!==null)&&Y(m,"alias node should not have any properties")):Xt(m,pe,l===ie)&&(le=!0,m.tag===null&&(m.tag="?")),m.anchor!==null&&Te(m,m.anchor,m.result)}else j===0&&(le=G&&ni(m,xe));if(m.tag===null)m.anchor!==null&&Te(m,m.anchor,m.result);else if(m.tag==="?"){m.result!==null&&m.kind!=="scalar"&&Y(m,'unacceptable node kind for !<?> tag; it should be "scalar", not "'+m.kind+'"');for(let Ae=0,Le=m.implicitTypes.length;Ae<Le;Ae+=1)if(Q=m.implicitTypes[Ae],Q.resolve(m.result)){m.result=Q.construct(m.result),m.tag=Q.tag,m.anchor!==null&&Te(m,m.anchor,m.result);break}}else if(m.tag!=="!"){if(s.call(m.typeMap[m.kind||"fallback"],m.tag))Q=m.typeMap[m.kind||"fallback"][m.tag];else{Q=null;let Ae=m.typeMap.multi[m.kind||"fallback"];for(let Le=0,ze=Ae.length;Le<ze;Le+=1)if(m.tag.slice(0,Ae[Le].tag.length)===Ae[Le].tag){Q=Ae[Le];break}}Q||Y(m,"unknown tag !<"+m.tag+">"),m.result!==null&&Q.kind!==m.kind&&Y(m,"unacceptable node kind for !<"+m.tag+'> tag; it should be "'+Q.kind+'", not "'+m.kind+'"'),Q.resolve(m.result,m.tag)?(m.result=Q.construct(m.result,m.tag),m.anchor!==null&&Te(m,m.anchor,m.result)):Y(m,"cannot resolve a node with !<"+m.tag+"> explicit tag")}return m.listener!==null&&m.listener("close",m),m.depth-=1,m.tag!==null||m.anchor!==null||le}function xi(m){let W=m.position,ie=!1,ee;for(m.version=null,m.checkLineBreaks=m.legacy,m.tagMap=Object.create(null),m.anchorMap=Object.create(null);(ee=m.input.charCodeAt(m.position))!==0&&(Be(m,!0,-1),ee=m.input.charCodeAt(m.position),!(m.lineIndent>0||ee!==37));){ie=!0,ee=m.input.charCodeAt(++m.position);let K=m.position;for(;ee!==0&&!L(ee);)ee=m.input.charCodeAt(++m.position);let P=m.input.slice(K,m.position),G=[];for(P.length<1&&Y(m,"directive name must not be less than one character in length");ee!==0;){for(;B(ee);)ee=m.input.charCodeAt(++m.position);if(ee===35){do ee=m.input.charCodeAt(++m.position);while(ee!==0&&!T(ee));break}if(T(ee))break;for(K=m.position;ee!==0&&!L(ee);)ee=m.input.charCodeAt(++m.position);G.push(m.input.slice(K,m.position))}ee!==0&&Ge(m),s.call(me,P)?me[P](m,P,G):Ie(m,'unknown document directive "'+P+'"')}if(Be(m,!0,-1),m.lineIndent===0&&m.input.charCodeAt(m.position)===45&&m.input.charCodeAt(m.position+1)===45&&m.input.charCodeAt(m.position+2)===45?(m.position+=3,Be(m,!0,-1)):ie&&Y(m,"directives end mark is expected"),Ot(m,m.lineIndent-1,p,!1,!0),Be(m,!0,-1),m.checkLineBreaks&&C.test(m.input.slice(W,m.position))&&Ie(m,"non-ASCII line breaks are interpreted as content"),m.documents.push(m.result),m.position===m.lineStart&&Je(m)){m.input.charCodeAt(m.position)===46&&(m.position+=3,Be(m,!0,-1));return}m.position<m.length-1&&Y(m,"end of the stream or a document separator is expected")}function si(m,W){m=String(m),W=W||{},m.length!==0&&(m.charCodeAt(m.length-1)!==10&&m.charCodeAt(m.length-1)!==13&&(m+=`
`),m.charCodeAt(0)===65279&&(m=m.slice(1)));let ie=new $e(m,W),ee=m.indexOf("\0");for(ee!==-1&&(ie.position=ee,Y(ie,"null byte is not allowed in input")),ie.input+="\0";ie.input.charCodeAt(ie.position)===32;)ie.lineIndent+=1,ie.position+=1;for(;ie.position<ie.length-1;)xi(ie);return ie.documents}function Tt(m,W,ie){W!==null&&typeof W=="object"&&typeof ie>"u"&&(ie=W,W=null);let ee=si(m,ie);if(typeof W!="function")return ee;for(let K=0,P=ee.length;K<P;K+=1)W(ee[K])}function Di(m,W){let ie=si(m,W);if(ie.length!==0){if(ie.length===1)return ie[0];throw new t("expected a single document in the stream, but found more")}}return an.loadAll=Tt,an.load=Di,an}var As={},Su;function L_(){if(Su)return As;Su=1;let e=yr(),t=_r(),r=Os(),n=Object.prototype.toString,s=Object.prototype.hasOwnProperty,l=65279,a=9,d=10,p=13,c=32,g=33,_=34,w=35,C=37,x=38,S=39,N=42,E=44,T=45,B=58,L=61,M=62,F=63,U=64,k=91,re=93,oe=96,ye=123,fe=124,ce=125,$e={};$e[0]="\\0",$e[7]="\\a",$e[8]="\\b",$e[9]="\\t",$e[10]="\\n",$e[11]="\\v",$e[12]="\\f",$e[13]="\\r",$e[27]="\\e",$e[34]='\\"',$e[92]="\\\\",$e[133]="\\N",$e[160]="\\_",$e[8232]="\\L",$e[8233]="\\P";let q=["y","Y","yes","Yes","YES","on","On","ON","n","N","no","No","NO","off","Off","OFF"],Y=/^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;function Ie(P,G){if(G===null)return{};let j={},se=Object.keys(G);for(let le=0,ue=se.length;le<ue;le+=1){let Q=se[le],pe=String(G[Q]);Q.slice(0,2)==="!!"&&(Q="tag:yaml.org,2002:"+Q.slice(2));let xe=P.compiledTypeMap.fallback[Q];xe&&s.call(xe.styleAliases,pe)&&(pe=xe.styleAliases[pe]),j[Q]=pe}return j}function Te(P){let G,j,se=P.toString(16).toUpperCase();if(P<=255)G="x",j=2;else if(P<=65535)G="u",j=4;else if(P<=4294967295)G="U",j=8;else throw new t("code point within a string may not be greater than 0xFFFFFFFF");return"\\"+G+e.repeat("0",j-se.length)+se}let be=1,ke=2;function ne(P){this.schema=P.schema||r,this.indent=Math.max(1,P.indent||2),this.noArrayIndent=P.noArrayIndent||!1,this.skipInvalid=P.skipInvalid||!1,this.flowLevel=e.isNothing(P.flowLevel)?-1:P.flowLevel,this.styleMap=Ie(this.schema,P.styles||null),this.sortKeys=P.sortKeys||!1,this.lineWidth=P.lineWidth||80,this.noRefs=P.noRefs||!1,this.noCompatMode=P.noCompatMode||!1,this.condenseFlow=P.condenseFlow||!1,this.quotingType=P.quotingType==='"'?ke:be,this.forceQuotes=P.forceQuotes||!1,this.replacer=typeof P.replacer=="function"?P.replacer:null,this.implicitTypes=this.schema.compiledImplicit,this.explicitTypes=this.schema.compiledExplicit,this.tag=null,this.result="",this.duplicates=[],this.usedDuplicates=null}function Se(P,G){let j=e.repeat(" ",G),se=0,le="",ue=P.length;for(;se<ue;){let Q,pe=P.indexOf(`
`,se);pe===-1?(Q=P.slice(se),se=ue):(Q=P.slice(se,pe+1),se=pe+1),Q.length&&Q!==`
`&&(le+=j),le+=Q}return le}function ve(P,G){return`
`+e.repeat(" ",P.indent*G)}function me(P,G){for(let j=0,se=P.implicitTypes.length;j<se;j+=1)if(P.implicitTypes[j].resolve(G))return!0;return!1}function Ue(P){return P===c||P===a}function st(P){return P>=32&&P<=126||P>=161&&P<=55295&&P!==8232&&P!==8233||P>=57344&&P<=65533&&P!==l||P>=65536&&P<=1114111}function et(P){return st(P)&&P!==l&&P!==p&&P!==d}function it(P,G,j){let se=et(P),le=se&&!Ue(P);return(j?se:se&&P!==E&&P!==k&&P!==re&&P!==ye&&P!==ce)&&P!==w&&!(G===B&&!le)||et(G)&&!Ue(G)&&P===w||G===B&&le}function Ge(P){return st(P)&&P!==l&&!Ue(P)&&P!==T&&P!==F&&P!==B&&P!==E&&P!==k&&P!==re&&P!==ye&&P!==ce&&P!==w&&P!==x&&P!==N&&P!==g&&P!==fe&&P!==L&&P!==M&&P!==S&&P!==_&&P!==C&&P!==U&&P!==oe}function Be(P){return!Ue(P)&&P!==B}function Je(P,G){let j=P.charCodeAt(G),se;return j>=55296&&j<=56319&&G+1<P.length&&(se=P.charCodeAt(G+1),se>=56320&&se<=57343)?(j-55296)*1024+se-56320+65536:j}function _t(P){return/^\n* /.test(P)}let Xt=1,vt=2,Qe=3,ri=4,Et=5;function ni(P,G,j,se,le,ue,Q,pe){let xe,Ee=0,Ae=null,Le=!1,ze=!1,kt=se!==-1,oi=-1,ai=Ge(Je(P,0))&&Be(Je(P,P.length-1));if(G||Q)for(xe=0;xe<P.length;Ee>=65536?xe+=2:xe++){if(Ee=Je(P,xe),!st(Ee))return Et;ai=ai&&it(Ee,Ae,pe),Ae=Ee}else{for(xe=0;xe<P.length;Ee>=65536?xe+=2:xe++){if(Ee=Je(P,xe),Ee===d)Le=!0,kt&&(ze=ze||xe-oi-1>se&&P[oi+1]!==" ",oi=xe);else if(!st(Ee))return Et;ai=ai&&it(Ee,Ae,pe),Ae=Ee}ze=ze||kt&&xe-oi-1>se&&P[oi+1]!==" "}return!Le&&!ze?ai&&!Q&&!le(P)?Xt:ue===ke?Et:vt:j>9&&_t(P)?Et:Q?ue===ke?Et:vt:ze?ri:Qe}function xt(P,G,j,se,le){P.dump=(function(){if(G.length===0)return P.quotingType===ke?'""':"''";if(!P.noCompatMode&&(q.indexOf(G)!==-1||Y.test(G)))return P.quotingType===ke?'"'+G+'"':"'"+G+"'";let ue=P.indent*Math.max(1,j),Q=P.lineWidth===-1?-1:Math.max(Math.min(P.lineWidth,40),P.lineWidth-ue),pe=se||P.flowLevel>-1&&j>=P.flowLevel;function xe(Ee){return me(P,Ee)}switch(ni(G,pe,P.indent,Q,xe,P.quotingType,P.forceQuotes&&!se,le)){case Xt:return G;case vt:return"'"+G.replace(/'/g,"''")+"'";case Qe:return"|"+zt(G,P.indent)+pi(Se(G,ue));case ri:return">"+zt(G,P.indent)+pi(Se(At(G,Q),ue));case Et:return'"'+Ot(G)+'"';default:throw new t("impossible error: invalid scalar style")}})()}function zt(P,G){let j=_t(P)?String(G):"",se=P[P.length-1]===`
`,ue=se&&(P[P.length-2]===`
`||P===`
`)?"+":se?"":"-";return j+ue+`
`}function pi(P){return P[P.length-1]===`
`?P.slice(0,-1):P}function At(P,G){let j=/(\n+)([^\n]*)/g,se=(function(){let pe=P.indexOf(`
`);return pe=pe!==-1?pe:P.length,j.lastIndex=pe,ci(P.slice(0,pe),G)})(),le=P[0]===`
`||P[0]===" ",ue,Q;for(;Q=j.exec(P);){let pe=Q[1],xe=Q[2];ue=xe[0]===" ",se+=pe+(!le&&!ue&&xe!==""?`
`:"")+ci(xe,G),le=ue}return se}function ci(P,G){if(P===""||P[0]===" ")return P;let j=/ [^ ]/g,se,le=0,ue,Q=0,pe=0,xe="";for(;se=j.exec(P);)pe=se.index,pe-le>G&&(ue=Q>le?Q:pe,xe+=`
`+P.slice(le,ue),le=ue+1),Q=pe;return xe+=`
`,P.length-le>G&&Q>le?xe+=P.slice(le,Q)+`
`+P.slice(Q+1):xe+=P.slice(le),xe.slice(1)}function Ot(P){let G="",j=0;for(let se=0;se<P.length;j>=65536?se+=2:se++){j=Je(P,se);let le=$e[j];!le&&st(j)?(G+=P[se],j>=65536&&(G+=P[se+1])):G+=le||Te(j)}return G}function xi(P,G,j){let se="",le=P.tag;for(let ue=0,Q=j.length;ue<Q;ue+=1){let pe=j[ue];P.replacer&&(pe=P.replacer.call(j,String(ue),pe)),(W(P,G,pe,!1,!1)||typeof pe>"u"&&W(P,G,null,!1,!1))&&(se!==""&&(se+=","+(P.condenseFlow?"":" ")),se+=P.dump)}P.tag=le,P.dump="["+se+"]"}function si(P,G,j,se){let le="",ue=P.tag;for(let Q=0,pe=j.length;Q<pe;Q+=1){let xe=j[Q];P.replacer&&(xe=P.replacer.call(j,String(Q),xe)),(W(P,G+1,xe,!0,!0,!1,!0)||typeof xe>"u"&&W(P,G+1,null,!0,!0,!1,!0))&&((!se||le!=="")&&(le+=ve(P,G)),P.dump&&d===P.dump.charCodeAt(0)?le+="-":le+="- ",le+=P.dump)}P.tag=ue,P.dump=le||"[]"}function Tt(P,G,j){let se="",le=P.tag,ue=Object.keys(j);for(let Q=0,pe=ue.length;Q<pe;Q+=1){let xe="";se!==""&&(xe+=", "),P.condenseFlow&&(xe+='"');let Ee=ue[Q],Ae=j[Ee];P.replacer&&(Ae=P.replacer.call(j,Ee,Ae)),W(P,G,Ee,!1,!1)&&(P.dump.length>1024&&(xe+="? "),xe+=P.dump+(P.condenseFlow?'"':"")+":"+(P.condenseFlow?"":" "),W(P,G,Ae,!1,!1)&&(xe+=P.dump,se+=xe))}P.tag=le,P.dump="{"+se+"}"}function Di(P,G,j,se){let le="",ue=P.tag,Q=Object.keys(j);if(P.sortKeys===!0)Q.sort();else if(typeof P.sortKeys=="function")Q.sort(P.sortKeys);else if(P.sortKeys)throw new t("sortKeys must be a boolean or a function");for(let pe=0,xe=Q.length;pe<xe;pe+=1){let Ee="";(!se||le!=="")&&(Ee+=ve(P,G));let Ae=Q[pe],Le=j[Ae];if(P.replacer&&(Le=P.replacer.call(j,Ae,Le)),!W(P,G+1,Ae,!0,!0,!0))continue;let ze=P.tag!==null&&P.tag!=="?"||P.dump&&P.dump.length>1024;ze&&(P.dump&&d===P.dump.charCodeAt(0)?Ee+="?":Ee+="? "),Ee+=P.dump,ze&&(Ee+=ve(P,G)),W(P,G+1,Le,!0,ze)&&(P.dump&&d===P.dump.charCodeAt(0)?Ee+=":":Ee+=": ",Ee+=P.dump,le+=Ee)}P.tag=ue,P.dump=le||"{}"}function m(P,G,j){let se=j?P.explicitTypes:P.implicitTypes;for(let le=0,ue=se.length;le<ue;le+=1){let Q=se[le];if((Q.instanceOf||Q.predicate)&&(!Q.instanceOf||typeof G=="object"&&G instanceof Q.instanceOf)&&(!Q.predicate||Q.predicate(G))){if(j?Q.multi&&Q.representName?P.tag=Q.representName(G):P.tag=Q.tag:P.tag="?",Q.represent){let pe=P.styleMap[Q.tag]||Q.defaultStyle,xe;if(n.call(Q.represent)==="[object Function]")xe=Q.represent(G,pe);else if(s.call(Q.represent,pe))xe=Q.represent[pe](G,pe);else throw new t("!<"+Q.tag+'> tag resolver accepts not "'+pe+'" style');P.dump=xe}return!0}}return!1}function W(P,G,j,se,le,ue,Q){P.tag=null,P.dump=j,m(P,j,!1)||m(P,j,!0);let pe=n.call(P.dump),xe=se;se&&(se=P.flowLevel<0||P.flowLevel>G);let Ee=pe==="[object Object]"||pe==="[object Array]",Ae,Le;if(Ee&&(Ae=P.duplicates.indexOf(j),Le=Ae!==-1),(P.tag!==null&&P.tag!=="?"||Le||P.indent!==2&&G>0)&&(le=!1),Le&&P.usedDuplicates[Ae])P.dump="*ref_"+Ae;else{if(Ee&&Le&&!P.usedDuplicates[Ae]&&(P.usedDuplicates[Ae]=!0),pe==="[object Object]")se&&Object.keys(P.dump).length!==0?(Di(P,G,P.dump,le),Le&&(P.dump="&ref_"+Ae+P.dump)):(Tt(P,G,P.dump),Le&&(P.dump="&ref_"+Ae+" "+P.dump));else if(pe==="[object Array]")se&&P.dump.length!==0?(P.noArrayIndent&&!Q&&G>0?si(P,G-1,P.dump,le):si(P,G,P.dump,le),Le&&(P.dump="&ref_"+Ae+P.dump)):(xi(P,G,P.dump),Le&&(P.dump="&ref_"+Ae+" "+P.dump));else if(pe==="[object String]")P.tag!=="?"&&xt(P,P.dump,G,ue,xe);else{if(pe==="[object Undefined]")return!1;if(P.skipInvalid)return!1;throw new t("unacceptable kind of an object to dump "+pe)}if(P.tag!==null&&P.tag!=="?"){let ze=encodeURI(P.tag[0]==="!"?P.tag.slice(1):P.tag).replace(/!/g,"%21");P.tag[0]==="!"?ze="!"+ze:ze.slice(0,18)==="tag:yaml.org,2002:"?ze="!!"+ze.slice(18):ze="!<"+ze+">",P.dump=ze+" "+P.dump}}return!0}function ie(P,G){let j=[],se=[];ee(P,j,se);let le=se.length;for(let ue=0;ue<le;ue+=1)G.duplicates.push(j[se[ue]]);G.usedDuplicates=new Array(le)}function ee(P,G,j){if(P!==null&&typeof P=="object"){let se=G.indexOf(P);if(se!==-1)j.indexOf(se)===-1&&j.push(se);else if(G.push(P),Array.isArray(P))for(let le=0,ue=P.length;le<ue;le+=1)ee(P[le],G,j);else{let le=Object.keys(P);for(let ue=0,Q=le.length;ue<Q;ue+=1)ee(P[le[ue]],G,j)}}}function K(P,G){G=G||{};let j=new ne(G);j.noRefs||ie(P,j);let se=P;return j.replacer&&(se=j.replacer.call({"":se},"",se)),W(j,0,se,!0,!0)?j.dump+`
`:""}return As.dump=K,As}var Pu;function M_(){if(Pu)return bt;Pu=1;let e=B_(),t=L_();function r(n,s){return function(){throw new Error("Function yaml."+n+" is removed in js-yaml 4. Use yaml."+s+" instead, which is now safe by default.")}}return bt.Type=Ct(),bt.Schema=Eu(),bt.FAILSAFE_SCHEMA=Nu(),bt.JSON_SCHEMA=Du(),bt.CORE_SCHEMA=zu(),bt.DEFAULT_SCHEMA=Os(),bt.load=e.load,bt.loadAll=e.loadAll,bt.dump=t.dump,bt.YAMLException=_r(),bt.types={binary:qu(),float:Ru(),map:ku(),null:Bu(),pairs:Xu(),set:Yu(),timestamp:Fu(),bool:Lu(),int:Mu(),merge:Uu(),omap:Wu(),seq:Ou(),str:Au()},bt.safeLoad=r("safeLoad","load"),bt.safeLoadAll=r("safeLoadAll","loadAll"),bt.safeDump=r("safeDump","dump"),bt}var R_=M_(),ln=k_(R_),{Type:Zb,Schema:Jb,FAILSAFE_SCHEMA:Qb,JSON_SCHEMA:ex,CORE_SCHEMA:tx,DEFAULT_SCHEMA:ix,load:rx,loadAll:nx,dump:sx,YAMLException:ox,types:ax,safeLoad:lx,safeLoadAll:ux,safeDump:dx}=ln;var Dr=O_(Gu(),1);var nr=null;var jb={},sw=Object.defineProperty,ow=(e,t,r)=>t in e?sw(e,t,{enumerable:!0,configurable:!0,writable:!0,value:r}):e[t]=r,ct=(e,t,r)=>ow(e,typeof t!="symbol"?t+"":t,r);function A0(e,t,r){let n="";for(let s=t;s<t+r;s+=1){let l=e[s];if(l===0)break;n+=String.fromCharCode(l)}return n.replace(/\0.*$/,"").trim()}function aw(e,t,r){let n=A0(e,t,r).replace(/\0/g,"").trim();return n?Number.parseInt(n,8):0}function lw(e,t){for(let r=t;r<t+512;r+=1)if(e[r]!==0)return!1;return!0}function Ma(e){return e.replace(/^\.?\//,"")}function uw(e){let t=Ma(e).split("/");return(t[t.length-1]||"").startsWith("._")||t.includes("PaxHeader")||t.includes("__MACOSX")}function dw(e){let t=e instanceof Uint8Array?e:new Uint8Array(e),r=new Map,n=0;for(;n+512<=t.length&&!lw(t,n);){let s=Ma(A0(t,n,100)),l=aw(t,n+124,12),a=t[n+156],d=n+512,p=d+l;a!==53&&a!==120&&s&&!uw(s)&&r.set(s,t.slice(d,p)),n=d+Math.ceil(l/512)*512}return r}function x0(e,t){let r=Ma(t),n=e.get(r);if(n)return n;for(let[s,l]of e)if(s.endsWith(`/${r}`)||s===r)return l;throw new Error(`Entry "${t}" was not found in the tar archive.`)}var O0={"PP-OCRv5_mobile_det":{url:"https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar"},"PP-OCRv5_mobile_rec":{url:"https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_rec_onnx_infer.tar"},"PP-OCRv6_small_det":{url:"https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_small_det_onnx_infer.tar"},"PP-OCRv6_small_rec":{url:"https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_small_rec_onnx_infer.tar"},"PP-OCRv6_tiny_det":{url:"https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_tiny_det_onnx_infer.tar"},"PP-OCRv6_tiny_rec":{url:"https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv6_tiny_rec_onnx_infer.tar"}},Rn=Object.freeze({model:"inference.onnx",config:"inference.yml"});function $0(e){return typeof e=="string"&&e.length>0}function pw(e){return!!(e&&typeof e=="object"&&!Array.isArray(e))}function cw(e,t){if($0(t)){let r=O0[t];if(!r)throw new Error(`Asset "${e}" references unknown model asset "${t}".`);return{url:r.url}}if(!pw(t))throw new Error(`Asset "${e}" must be an object.`);if(!$0(t.url))throw new Error(`Asset "${e}" must define url.`);return{url:t.url}}function fw(e,t,r){if(t==="model"){if(!(r instanceof Uint8Array)||r.byteLength===0)throw new Error(`${e} model requires a non-empty ${Rn.model} resource.`);return}if(t==="config"){if(typeof r!="string"||r.trim().length===0)throw new Error(`${e} model requires a non-empty ${Rn.config} resource.`);return}throw new Error(`Unsupported model resource slot "${t}".`)}function k0(e,t){for(let[r,n]of Object.entries(t))fw(e,r,n)}async function C0(e,t=fetch){let r=await t(e.url);if(!r.ok)throw new Error(`Failed to download ${e.url}: HTTP ${String(r.status)}`);let n=await r.arrayBuffer(),s=dw(n),l=x0(s,Rn.model),a=x0(s,Rn.config);return{modelBytes:l,configText:new TextDecoder().decode(a),download:{url:e.url,bytes:n.byteLength}}}var Ca="OCR";function Ri(e){return!!e&&typeof e=="object"&&!Array.isArray(e)}function Pt(e){if(e==null||e==="")return;let t=Number(e);return Number.isFinite(t)?t:void 0}function Ia(e){let t=Pt(e);return t!==void 0&&t>=1?t:1}function hw(e,t){return e!=="general"?t:{text_det_limit_side_len:t.text_det_limit_side_len??960,text_det_limit_type:t.text_det_limit_type??"max",text_det_max_side_limit:t.text_det_max_side_limit??4e3,text_det_thresh:t.text_det_thresh??.3,text_det_box_thresh:t.text_det_box_thresh??.6,text_det_unclip_ratio:t.text_det_unclip_ratio??2,text_rec_score_thresh:t.text_rec_score_thresh??0}}function mw(e){if(typeof e=="string"){let t=ln.load(e);if(!Ri(t))throw new Error("OCR pipeline config text must decode to an object.");return t}if(!Ri(e))throw new Error("OCR pipeline config must be an object or YAML text.");return e}function I0(e,t,r){e.push(`${t} is not yet supported in PaddleOCR.js${`: ${r}`}.`)}function Pa(e){return typeof e?.model_name=="string"?e.model_name:null}function gw(e,t){if(!t)throw new Error(`${e}.model_name must be provided when ${e}.model_dir is set.`)}function T0(e,t,r){if(r?.model_dir==null)return null;if(Ri(r.model_dir)){let n=cw(e,r.model_dir);return gw(t,Pa(r)),n}throw new Error(`${t}.model_dir must be null or an asset descriptor object in browser usage.`)}function N0(e){let t=mw(e),r=t.pipeline_name??Ca;if(r!==Ca)throw new Error(`Unsupported pipeline_name "${r}". PaddleOCR.js currently supports only "${Ca}".`);let n=[],s=Ri(t.SubModules)?t.SubModules:{},l=Ri(s.TextDetection)?s.TextDetection:null,a=Ri(s.TextRecognition)?s.TextRecognition:null;if(!l||!a)throw new Error('OCR pipeline config must define both "SubModules.TextDetection" and "SubModules.TextRecognition".');let d=!!t.use_doc_preprocessor,p=!!t.use_textline_orientation,c=t.SubPipelines,g=Ri(c?.DocPreprocessor)?c.DocPreprocessor:null,_=Ri(s.TextLineOrientation)?s.TextLineOrientation:null;(d||g)&&I0(n,"DocPreprocessor","config will be ignored for now"),(p||_)&&I0(n,"TextLineOrientation","config will be ignored for now");let w=typeof t.text_type=="string"&&t.text_type.length>0?t.text_type:"general";t.text_type&&t.text_type!=="general"&&n.push(`text_type ${JSON.stringify(t.text_type)} is not used by PaddleOCR.js yet.`);let C=T0("det","SubModules.TextDetection",l),x=T0("rec","SubModules.TextRecognition",a),S=Ia(t.batch_size),N=Ia(l.batch_size),E=Ia(a.batch_size);return{pipelineName:r,raw:t,warnings:n,unsupportedFeatures:[...d||g?["DocPreprocessor"]:[],...p||_?["TextLineOrientation"]:[]],modelSelection:{textDetectionModelName:Pa(l),textRecognitionModelName:Pa(a)},assets:{...C?{det:C}:{},...x?{rec:x}:{}},runtimeDefaults:hw(w,{text_det_limit_side_len:Pt(l.limit_side_len),text_det_limit_type:l.limit_type||void 0,text_det_max_side_limit:Pt(l.max_side_limit),text_det_thresh:Pt(l.thresh),text_det_box_thresh:Pt(l.box_thresh),text_det_unclip_ratio:Pt(l.unclip_ratio),text_rec_score_thresh:Pt(a.score_thresh)}),pipelineBatchSize:S,textDetectionBatchSize:N,textRecognitionBatchSize:E}}function yw(){if(globalThis.location.protocol==="file:")throw new Error("PaddleOCR.js requires an HTTP(S) origin so model assets can be fetched.")}function S0(e){return typeof globalThis[e]<"u"}async function B0(e){if(typeof ImageBitmap<"u"&&e instanceof ImageBitmap)return e;if(e instanceof Blob||S0("HTMLCanvasElement")&&e instanceof HTMLCanvasElement)return createImageBitmap(e);if(e instanceof ImageData){let t=document.createElement("canvas");t.width=e.width,t.height=e.height;let r=t.getContext("2d");if(!r)throw new Error("Failed to create a 2D canvas context.");return r.putImageData(e,0,0),createImageBitmap(t)}if(S0("HTMLImageElement")&&e instanceof HTMLImageElement)return createImageBitmap(e);throw new Error("Unsupported image source. Use a Blob, ImageBitmap, ImageData, canvas, or img.")}async function _w(e){return typeof ImageBitmap<"u"&&e instanceof ImageBitmap?createImageBitmap(e):B0(e)}function vw(e,t){let r=document.createElement("canvas");r.width=t.width,r.height=t.height;let n=r.getContext("2d",{willReadFrequently:!0});if(!n)throw new Error("Failed to create a 2D canvas context.");return n.drawImage(t,0,0),{canvas:r,mat:e.imread(r)}}async function ww(e,t){if(typeof e.Mat=="function"&&t instanceof e.Mat){let s=t.clone();return{width:t.cols,height:t.rows,mat:s,dispose(){s.delete()}}}let r=await B0(t),n=vw(e,r);return{width:r.width,height:r.height,mat:n.mat,dispose(){n.mat.delete(),r.close()}}}async function bw(e){if(typeof ImageBitmap>"u"||typeof createImageBitmap!="function")throw new Error("Worker mode requires ImageBitmap support in this browser.");let t=await _w(e);return{payload:{kind:"imageBitmap",imageBitmap:t},transferables:[t]}}var Bn=null;async function xw(){return Bn||(Bn=Promise.resolve().then(()=>(b0(),w0)),Bn)}async function $w(){var e;let t=(e=globalThis.navigator)==null?void 0:e.gpu;if(!t?.requestAdapter)return{available:!1,reason:"navigator.gpu is unavailable in this browser."};try{return await t.requestAdapter()?{available:!0,reason:""}:{available:!1,reason:"The browser did not return a WebGPU adapter."}}catch(r){return{available:!1,reason:r instanceof Error?r.message:"Failed to request a WebGPU adapter."}}}function L0(e,t){if(e==="webgpu"){if(!t.available)throw new Error(`WebGPU is unavailable: ${t.reason}`);return[["webgpu"]]}return e==="wasm"?[["wasm"]]:t.available?[["webgpu"],["wasm"]]:[["wasm"]]}function Cw(e,t){let r=e.env.wasm;t.wasmPaths!==void 0&&(r.wasmPaths=t.wasmPaths),t.numThreads!==void 0&&(r.numThreads=t.numThreads),t.simd!==void 0&&(r.simd=t.simd),t.proxy!==void 0&&(r.proxy=t.proxy),t.disableWasmProxy&&(r.proxy=!1)}async function Iw(e={}){let t=typeof e=="string"?e:e.backend==="webgpu"||e.backend==="wasm"?e.backend:"auto",r=await $w(),n=await xw();return typeof e!="string"&&Cw(n,e),{ort:n,webgpuState:r,backend:t}}async function M0(e,t,r){let n=null;for(let s of r)try{return{session:await e.InferenceSession.create(t,{executionProviders:s,graphOptimizationLevel:"all"}),provider:s[0]}}catch(l){n=l}throw n instanceof Error?n:new Error("Failed to create ONNX session.")}async function R0(...e){await Promise.all(e.map(async t=>{t?.release&&await t.release()}))}function Mi(){return performance.now()}function bi(e,t,r){return Math.max(t,Math.min(r,e))}function Ea(e,t){let r=e[0]-t[0],n=e[1]-t[1];return Math.sqrt(r*r+n*n)}function D0(e,t,r){let n=!1;return new Promise((s,l)=>{let a=setTimeout(()=>{n||(n=!0,l(new Error(`${r} timed out after ${String(t/1e3)}s`)))},t);e.then(d=>{n||(n=!0,clearTimeout(a),s(d))}).catch(d=>{n||(n=!0,clearTimeout(a),l(d))})})}function z0(e,t){let r=e??t,n=typeof r=="number"?r:typeof r=="string"?Number.parseInt(r,10):Number.NaN;return Math.max(1,Number.isFinite(n)?n:1)}function Ra(e,t){let r=[];for(let n=0;n<e.length;n+=t)r.push(e.slice(n,n+t));return r}function F0(e){return structuredClone(e)}async function U0(e,t){let r=e.inputNames[0];return(await e.run({[r]:t}))[e.outputNames[0]]}function q0(e){return!!e&&typeof e=="object"&&!Array.isArray(e)}function Da(e){let t=ln.load(e);return q0(t)?t:{}}function Tw(e,t){if(typeof e=="number")return e;if(typeof e!="string")return t;let r=e.replace(/\s/g,""),n=Number(r);if(!Number.isNaN(n))return n;let s=r.split("/");if(s.length===2){let l=Number(s[0].replace(/\.+$/,"")),a=Number(s[1].replace(/\.+$/,""));if(!Number.isNaN(l)&&!Number.isNaN(a)&&a!==0)return l/a}return t}function Aa(e,t){for(let r of e||[])if(Object.prototype.hasOwnProperty.call(r,t))return r[t];return null}function Oa(e){if(Array.isArray(e)){for(let t of e){let r=Oa(t);if(r)return r}return null}if(!q0(e))return null;for(let[t,r]of Object.entries(e)){if(t==="model_name"&&typeof r=="string"&&r.trim())return r;let n=Oa(r);if(n)return n}return null}function Sw(e){var t;let r=Da(e),n=[(t=r.Global)==null?void 0:t.model_name,r.model_name];for(let s of n)if(typeof s=="string"&&s.trim())return s;return Oa(r)}function W0(e,t,r,n){let s=new Float32Array(3*t*r),l=t*r,a=n.mean,d=n.std,p=n.scale;for(let c=0;c<r;c+=1)for(let g=0;g<t;g+=1){let _=c*t+g,w=_*3,C=e[w],x=e[w+1],S=e[w+2];s[_]=(C*p-a[0])/d[0],s[_+l]=(x*p-a[1])/d[1],s[_+2*l]=(S*p-a[2])/d[2]}return s}function Pw(e){let t=e.slice().sort((a,d)=>a[0]-d[0]),r,n,s,l;return t[1][1]>t[0][1]?(r=0,l=1):(r=1,l=0),t[3][1]>t[2][1]?(n=2,s=3):(n=3,s=2),[t[r],t[n],t[s],t[l]]}function X0(e){let t=0;for(let r=0;r<e.length;r+=1){let n=(r+1)%e.length;t+=e[r][0]*e[n][1]-e[n][0]*e[r][1]}return Math.abs(t)*.5}function Ew(e){let t=0;for(let r=0;r<e.length;r+=1){let n=(r+1)%e.length;t+=Ea(e[r],e[n])}return t}function Aw(e){let t=null,r=0;for(let n of e){if(n.length<4)continue;let s=n.map(a=>[a.X,a.Y]),l=X0(s);l>r&&(r=l,t=n)}return t}function Ow(e,t){let r=X0(e),n=Ew(e);if(n<=0)return null;let s=r*t/n,l=e.map(c=>({X:Math.trunc(c[0]),Y:Math.trunc(c[1])})),a=new Dr.default.ClipperOffset;a.AddPath(l,Dr.default.JoinType.jtRound,Dr.default.EndType.etClosedPolygon);let d=new Dr.default.Paths;a.Execute(d,s);let p=Aw(d);return p?p.map(c=>[c.X,c.Y]):null}function ka(e,t){let r=[];for(let c of t)r.push(c[0],c[1]);let n=e.matFromArray(t.length,1,e.CV_32FC2,r),s=e.minAreaRect(n),l=e.RotatedRect.points(s),a=[];for(let c=0;c<4;c+=1)a.push([l[c].x,l[c].y]);n.delete();let d=Pw(a),p=Math.min(Ea(d[0],d[1]),Ea(d[1],d[2]));return{box:d,side:p}}function kw(e,t,r){let n=t.rows,s=t.cols,l=s-1,a=0,d=n-1,p=0;for(let T of r)l=Math.min(l,T[0]),a=Math.max(a,T[0]),d=Math.min(d,T[1]),p=Math.max(p,T[1]);l=bi(Math.floor(l),0,s-1),a=bi(Math.ceil(a),0,s-1),d=bi(Math.floor(d),0,n-1),p=bi(Math.ceil(p),0,n-1);let c=Math.max(1,a-l+1),g=Math.max(1,p-d+1),_=t.roi(new e.Rect(l,d,c,g)),w=e.Mat.zeros(g,c,e.CV_8UC1),C=r.map(T=>[Math.trunc(T[0]-l),Math.trunc(T[1]-d)]),x=[];for(let T of C)x.push(T[0],T[1]);let S=e.matFromArray(C.length,1,e.CV_32SC2,x),N=new e.MatVector;N.push_back(S),e.fillPoly(w,N,new e.Scalar(1));let E=e.mean(_,w)[0];return _.delete(),w.delete(),S.delete(),N.delete(),E}var P0=3,ii=Object.freeze({resizeLong:960,limitType:"max",maxSideLimit:4e3,normalize:{mean:[.485,.456,.406],std:[.229,.224,.225],scale:1/255},postprocess:{thresh:.3,boxThresh:.6,maxCandidates:1e3,unclipRatio:2}}),Nw=Object.freeze({...ii});function Bw(e){let t=typeof e=="string"?e.trim().toLowerCase():"";return t==="min"||t==="max"?t:ii.limitType}function Lw(e){let t=Da(e),r=t.PreProcess,n=r?.transform_ops,s=Aa(n,"DetResizeForTest"),l=Aa(n,"NormalizeImage"),a=t.PostProcess||{},d=s?.max_side_limit,p=Number(d),c=Number.isFinite(p)&&p>0?p:ii.maxSideLimit;return{resizeLong:Number(s?.resize_long??ii.resizeLong),limitType:Bw(s?.limit_type),maxSideLimit:c,normalize:{mean:l?.mean??ii.normalize.mean,std:l?.std??ii.normalize.std,scale:Tw(l?.scale,ii.normalize.scale)},postprocess:{thresh:Number(a.thresh??ii.postprocess.thresh),boxThresh:Number(a.box_thresh??ii.postprocess.boxThresh),maxCandidates:Number(a.max_candidates??ii.postprocess.maxCandidates),unclipRatio:Number(a.unclip_ratio??ii.postprocess.unclipRatio)}}}function Mw(e,t){return{limitSideLen:t?.limitSideLen??e.limitSideLen,limitType:t?.limitType??e.limitType,maxSideLimit:t?.maxSideLimit??e.maxSideLimit,thresh:t?.thresh??e.thresh,boxThresh:t?.boxThresh??e.boxThresh,unclipRatio:t?.unclipRatio??e.unclipRatio}}async function Rw({ort:e,modelBytes:t,configText:r,backend:n,webgpuState:s,batchSize:l}){k0("Detection",{model:t,config:r});let a=Lw(r),d=Math.max(1,l??1),p={limitSideLen:a.resizeLong,limitType:a.limitType,maxSideLimit:a.maxSideLimit,thresh:a.postprocess.thresh,boxThresh:a.postprocess.boxThresh,unclipRatio:a.postprocess.unclipRatio},c=await Dw(e,t,n,s);return{kind:"det",config:a,get provider(){return c?.provider||""},async predict(g,_,w){if(!c?.session)throw new Error("Detection model session is not initialized.");let C=Mw(p,w),x=z0(w?.batchSize,d),S=[],N={cv:g,ort:e,config:a,session:c.session};for(let E of Ra(_,x)){let T=zw({cv:g,ort:e,config:a},E,C),B=Ww(e,T),L=await U0(c.session,B),M=Hw(N,L,T,C);for(let F of M)S.push({boxes:F.boxes,srcW:F.prep.srcW,srcH:F.prep.srcH})}return S},async dispose(){await R0(c?.session),c=null}}}async function Dw(e,t,r,n){let s=L0(r,n);return D0(M0(e,t,s),6e4,"Detection model")}function zw(e,t,r){return t.map(n=>Fw(e,n,r))}function Fw(e,t,r){let{cv:n,ort:s,config:l}=e,a=t.cols,d=t.rows,p=Math.max(32,r.limitSideLen),c=r.limitType,g=Math.max(32,r.maxSideLimit),_=1;if(c==="max"){let E=Math.max(a,d);E>p&&(_=p/Math.max(1,E))}else{let E=Math.min(a,d);E<p&&(_=p/Math.max(1,E))}let w=Math.max(32,Math.round(a*_/32)*32),C=Math.max(32,Math.round(d*_/32)*32);if(Math.max(w,C)>g){let E=g/Math.max(w,C);w=Math.max(32,Math.floor(w*E)),C=Math.max(32,Math.floor(C*E))}w=bi(w,32,g),C=bi(C,32,g),w=Math.max(32,Math.round(w/32)*32),C=Math.max(32,Math.round(C/32)*32);let x=new n.Mat,S=new n.Mat;n.resize(t,x,new n.Size(w,C),0,0,n.INTER_LINEAR),x.channels()===4?n.cvtColor(x,S,n.COLOR_RGBA2BGR):x.channels()===1?n.cvtColor(x,S,n.COLOR_GRAY2BGR):x.copyTo(S);let N=W0(S.data,w,C,l.normalize);return x.delete(),S.delete(),{tensor:new s.Tensor("float32",N,[1,3,C,w]),srcW:a,srcH:d,dstW:w,dstH:C}}function Uw(e){let t=e.dims,r=e.data;if(t.length===4)return{data:r,h:t[2],w:t[3]};if(t.length===3)return{data:r,h:t[1],w:t[2]};throw new Error(`Unexpected det output dims: [${t.join(", ")}]`)}function qw(e,t,r,n){let s=t.length,l=3*r*n,a=new Float32Array(s*l);for(let d=0;d<s;d+=1){let p=t[d],c=p.tensor.data,{dstH:g,dstW:_}=p,w=d*l;for(let C=0;C<3;C+=1){let x=C*g*_,S=w+C*r*n;for(let N=0;N<g;N+=1){let E=x+N*_,T=S+N*n;a.set(c.subarray(E,E+_),T)}}}return new e.Tensor("float32",a,[s,3,r,n])}function Ww(e,t){let r=Math.max(...t.map(s=>s.dstH)),n=Math.max(...t.map(s=>s.dstW));return qw(e,t,r,n)}function Xw(e,t){let r=e.slice(1).reduce((n,s)=>n*s,1);return t*r}function Yw(e,t,r,n,s,l){let a=Math.max(1,Math.min(s,Math.round(s*e/r))),d=Math.max(1,Math.min(l,Math.round(l*t/n)));return{cropOh:a,cropOw:d}}function Gw(e,t,r,n,s,l,a){let d=t.data,p=t.dims,c=Xw(p,r),g=new Float32Array(n*s);for(let _=0;_<n;_+=1){let w=c+_*a;g.set(d.subarray(w,w+s),_*s)}return new e.Tensor("float32",g,[1,1,n,s])}function Hw(e,t,r,n){let{cv:s,ort:l,config:a}=e,d=t.dims;if(d.length!==3&&d.length!==4)throw new Error(`Unexpected det output dims: [${d.join(", ")}]`);let p=d.length===4?d[2]:d[1],c=d.length===4?d[3]:d[2],g=d.length===4?d[0]:r.length===1?1:d[0];if(g!==r.length)throw new Error(`Detection batch output N=${String(g)} does not match input batch ${String(r.length)}`);let _=Math.max(...r.map(x=>x.dstH)),w=Math.max(...r.map(x=>x.dstW)),C=[];for(let x=0;x<r.length;x+=1){let S=r[x],{cropOh:N,cropOw:E}=Yw(S.dstH,S.dstW,_,w,p,c),T=Gw(l,t,x,N,E,p,c),B=Vw({cv:s,config:a},T,S,n.thresh,n.boxThresh,n.unclipRatio);C.push({prep:S,boxes:B})}return C}function Vw(e,t,r,n,s,l){let{cv:a,config:d}=e,{data:p,h:c,w:g}=Uw(t),_=a.matFromArray(c,g,a.CV_32FC1,p),w=new Uint8Array(c*g);for(let T=0;T<p.length;T+=1)w[T]=p[T]>n?255:0;let C=a.matFromArray(c,g,a.CV_8UC1,w),x=new a.MatVector,S=new a.Mat;a.findContours(C,x,S,a.RETR_LIST,a.CHAIN_APPROX_SIMPLE);let N=[],E=Math.min(d.postprocess.maxCandidates,x.size());for(let T=0;T<E;T+=1){let B=x.get(T);if(B.rows<4){B.delete();continue}let L=[];for(let oe=0;oe<B.rows;oe+=1)L.push([B.data32S[oe*2],B.data32S[oe*2+1]]);let M=ka(a,L);if(M.side<P0){B.delete();continue}let F=kw(a,_,M.box);if(F<s){B.delete();continue}let U=Ow(M.box,l);if(!U||U.length<4){B.delete();continue}let k=ka(a,U);if(k.side<P0+2){B.delete();continue}let re=k.box.map(oe=>[bi(Math.round(oe[0]*r.srcW/Math.max(1,g)),0,r.srcW),bi(Math.round(oe[1]*r.srcH/Math.max(1,c)),0,r.srcH)]);N.push({poly:re,score:F}),B.delete()}_.delete(),C.delete(),x.delete(),S.delete(),N.sort((T,B)=>T.poly[0][1]-B.poly[0][1]||T.poly[0][0]-B.poly[0][0]);for(let T=0;T<N.length-1;T+=1)for(let B=T;B>=0&&(Math.abs(N[B+1].poly[0][1]-N[B].poly[0][1])<10&&N[B+1].poly[0][0]<N[B].poly[0][0]);B-=1){let L=N[B];N[B]=N[B+1],N[B+1]=L}return N}var jw="0123456789abcdefghijklmnopqrstuvwxyz".split(""),Kw=Object.freeze({mean:[.5,.5,.5],std:[.5,.5,.5],scale:1/255}),Zw=Object.freeze({imageShape:[3,48,320],charDict:[]}),Jw=3200,Qw=Object.freeze({...Zw});function eb(e){let t=Da(e),r=t.PreProcess,n=r?.transform_ops,s=Aa(n,"RecResizeImg"),a=(t.PostProcess||{}).character_dict,d=s?.image_shape;if(!d||!Array.isArray(d)||d.length<3)throw new Error("RecResizeImg.image_shape is required in rec inference.yml");let p=Array.isArray(a)&&a.length>0?[...a," "]:[...jw," "];return{imageShape:d,charDict:p}}async function tb({ort:e,modelBytes:t,configText:r,backend:n,webgpuState:s,batchSize:l}){k0("Recognition",{model:t,config:r});let a=eb(r),d=Math.max(1,l??1),p=await ib(e,t,n,s);return{kind:"rec",config:a,get provider(){return p?.provider||""},async predict(c,g,_){if(!p?.session)throw new Error("Recognition model session is not initialized.");let w=z0(_?.batchSize,d),x=rb({cv:c,config:a},g),S=a.charDict,N=x.slice().sort((B,L)=>B.width-L.width),E=[],T=a.imageShape[1];for(let B of Ra(N,w)){let L=ob(e,B,T),M=await U0(p.session,L),F=lb(M,S);for(let U=0;U<F.length;U+=1)E.push({inputIndex:B[U].inputIndex,...F[U]})}return E.sort((B,L)=>B.inputIndex-L.inputIndex),E.map(({text:B,score:L})=>({text:B,score:L}))},async dispose(){await R0(p?.session),p=null}}}async function ib(e,t,r,n){let s=L0(r,n);return D0(M0(e,t,s),6e4,"Recognition model")}function rb(e,t){let r=[];for(let n=0;n<t.length;n+=1)r.push(nb(e,t[n],n));return r}function nb(e,t,r){let{cv:n,config:s}=e,[l,a,d]=s.imageShape,p=t.cols,c=t.rows;if(l!==3)throw new Error(`Unexpected recognition channels: ${String(l)}`);let g=p/Math.max(1,c),_=Math.max(d/Math.max(1,a),g),w=bi(Math.trunc(a*_),1,Jw),C=Math.min(w,Math.ceil(a*g)),x=new n.Mat,S=new n.Mat;n.resize(t,x,new n.Size(C,a),0,0,n.INTER_LINEAR),x.channels()===4?n.cvtColor(x,S,n.COLOR_RGBA2BGR):x.channels()===1?n.cvtColor(x,S,n.COLOR_GRAY2BGR):x.copyTo(S);let N=W0(S.data,C,a,Kw),E=new Float32Array(3*a*w),T=a*w,B=a*C;for(let L=0;L<3;L+=1)for(let M=0;M<a;M+=1){let F=L*B+M*C,U=L*T+M*w;E.set(N.subarray(F,F+C),U)}return S.delete(),x.delete(),{inputIndex:r,width:w,chw:E}}function sb(e,t,r,n){let s=t.length,l=new Float32Array(s*3*n*r),a=n*r;for(let d=0;d<s;d+=1){let p=t[d],c=p.width,g=n*c;for(let _=0;_<3;_+=1){let w=_*g,C=d*(3*a)+_*a;for(let x=0;x<n;x+=1){let S=w+x*c,N=C+x*r;l.set(p.chw.subarray(S,S+c),N)}}}return new e.Tensor("float32",l,[s,3,n,r])}function ob(e,t,r){let n=t.reduce((s,l)=>Math.max(s,l.width),1);return sb(e,t,n,r)}function ab(e,t,r,n,s){let l=-1,a="",d=[];for(let c=0;c<r;c+=1){let g=0,_=-1/0,w=t+c*n;for(let C=0;C<n;C+=1){let x=e[w+C];x>_&&(_=x,g=C)}if(g>0&&g!==l){let C=g-1;C>=0&&C<s.length&&(a+=s[C],d.push(_))}l=g}let p=d.length?d.reduce((c,g)=>c+g,0)/d.length:0;return{text:a,score:p}}function lb(e,t){let r=e.dims;if(r.length!==3)throw new Error(`Unexpected rec output dims: [${r.join(", ")}]`);let n=r[0],s=r[1],l=r[2],a=e.data,d=s*l,p=[];for(let c=0;c<n;c+=1)p.push(ab(a,c*d,s,l,t));return p}function ub(e,t,r){let n=ka(e,r).box,s=Math.hypot(n[1][0]-n[0][0],n[1][1]-n[0][1]),l=Math.hypot(n[2][0]-n[3][0],n[2][1]-n[3][1]),a=Math.hypot(n[3][0]-n[0][0],n[3][1]-n[0][1]),d=Math.hypot(n[2][0]-n[1][0],n[2][1]-n[1][1]),p=Math.max(1,Math.floor(Math.max(s,l))),c=Math.max(1,Math.floor(Math.max(a,d))),g=e.matFromArray(4,1,e.CV_32FC2,[n[0][0],n[0][1],n[1][0],n[1][1],n[2][0],n[2][1],n[3][0],n[3][1]]),_=e.matFromArray(4,1,e.CV_32FC2,[0,0,p,0,p,c,0,c]),w=e.getPerspectiveTransform(g,_),C=new e.Mat;if(e.warpPerspective(t,C,w,new e.Size(p,c),e.INTER_CUBIC,e.BORDER_REPLICATE,new e.Scalar),g.delete(),_.delete(),w.delete(),C.rows/Math.max(1,C.cols)>=1.5){let x=new e.Mat;return e.rotate(C,x,e.ROTATE_90_COUNTERCLOCKWISE),C.delete(),x}return C}var Ln=null;async function db(){let e;if(nr instanceof Promise)e=await nr;else{let t=nr;t.Mat?e=nr:(await new Promise(r=>{t.onRuntimeInitialized=()=>{r()}}),e=nr)}return{cv:e}}async function pb(){return Ln||(Ln=db().catch(e=>{throw Ln=null,e})),Ln}function ir(...e){for(let t of e)if(t!=null)return t}function Rr(e){if(e==null)return;let t=Number(e);return Number.isFinite(t)?t:void 0}function cb(e,t={},r={}){return{det:{limitSideLen:Rr(ir(r.text_det_limit_side_len,r.textDetLimitSideLen,t.text_det_limit_side_len,t.textDetLimitSideLen,e.det.resizeLong)),limitType:ir(r.text_det_limit_type,r.textDetLimitType,t.text_det_limit_type,t.textDetLimitType,e.det.limitType),maxSideLimit:Rr(ir(r.text_det_max_side_limit,r.textDetMaxSideLimit,t.text_det_max_side_limit,t.textDetMaxSideLimit,e.det.maxSideLimit)),thresh:Rr(ir(r.text_det_thresh,r.textDetThresh,t.text_det_thresh,t.textDetThresh,e.det.postprocess.thresh)),boxThresh:Rr(ir(r.text_det_box_thresh,r.textDetBoxThresh,t.text_det_box_thresh,t.textDetBoxThresh,e.det.postprocess.boxThresh)),unclipRatio:Rr(ir(r.text_det_unclip_ratio,r.textDetUnclipRatio,t.text_det_unclip_ratio,t.textDetUnclipRatio,e.det.postprocess.unclipRatio))},pipeline:{scoreThresh:Number(ir(r.text_rec_score_thresh,r.textRecScoreThresh,t.text_rec_score_thresh,t.textRecScoreThresh,0))}}}var fb=`
pipeline_name: OCR

text_type: general

use_doc_preprocessor: False
use_textline_orientation: False

SubPipelines:
  DocPreprocessor:
    pipeline_name: doc_preprocessor
    use_doc_orientation_classify: False
    use_doc_unwarping: False
    SubModules:
      DocOrientationClassify:
        module_name: doc_text_orientation
        model_name: PP-LCNet_x1_0_doc_ori
        model_dir: null
      DocUnwarping:
        module_name: image_unwarping
        model_name: UVDoc
        model_dir: null

SubModules:
  TextDetection:
    module_name: text_detection
    model_name: PP-OCRv5_mobile_det
    model_dir: null
    limit_side_len: 64
    limit_type: min
    max_side_limit: 4000
    thresh: 0.3
    box_thresh: 0.6
    unclip_ratio: 1.5
  TextLineOrientation:
    module_name: textline_orientation
    model_name: PP-LCNet_x1_0_textline_ori
    model_dir: null
    batch_size: 6
  TextRecognition:
    module_name: text_recognition
    model_name: PP-OCRv5_mobile_rec
    model_dir: null
    batch_size: 6
    score_thresh: 0.0
`.trimStart(),hb={det:Nw,rec:Qw},Y0=N0(fb),G0=Object.freeze({...Y0.modelSelection}),Mn=Object.freeze({...G0}),mb=Object.freeze({textDetectionModelName:"PP-OCRv6_small_det",textRecognitionModelName:"PP-OCRv6_small_rec"}),gb=new Set(["af","az","bs","cs","cy","da","de","es","et","fr","ga","hr","hu","id","is","it","ku","la","lt","lv","mi","ms","mt","nl","no","oc","pi","pl","pt","ro","rs_latin","sk","sl","sq","sv","sw","tl","tr","uz","vi","french","german","fi","eu","gl","lb","rm","ca","qu"]),yb=new Set(["pi"]),_b=new Set(["ch","chinese_cht","en","japan",...[...gb].filter(e=>!yb.has(e))]);function vb(e){return _b.has(e)}var za=Object.freeze([{assetKey:"det",modelRole:"TextDetection",selectionKey:"textDetectionModelName",nameAliases:["text_detection_model_name","textDetectionModelName"],assetAliases:["textDetectionModelAsset","text_detection_model_dir","textDetectionModelDir"],nameLabel:"text detection model name",assetLabel:"text detection model asset",assetRequirementError:"text_detection_model_dir requires text_detection_model_name."},{assetKey:"rec",modelRole:"TextRecognition",selectionKey:"textRecognitionModelName",nameAliases:["text_recognition_model_name","textRecognitionModelName"],assetAliases:["textRecognitionModelAsset","text_recognition_model_dir","textRecognitionModelDir"],nameLabel:"text recognition model name",assetLabel:"text recognition model asset",assetRequirementError:"text_recognition_model_dir requires text_recognition_model_name."}]),wb=new Map([["ch::PP-OCRv5",Mn],["chinese_cht::PP-OCRv5",Mn],["en::PP-OCRv5",Mn],["japan::PP-OCRv5",Mn]]);function Dt(e,t,r){let n,s=!1;for(let l of t){if(!(l in e))continue;let a=e[l];if(!s){n=a,s=!0;continue}if(a!==n)throw new Error(`Conflicting values provided for ${r}: ${t.join(", ")}.`)}return s?n:void 0}function bb(e){return e==="min"||e==="max"}function xb(e,t){let r={...e};for(let n of Object.keys(t)){let s=t[n];s!==void 0&&(r[n]=s)}return r}function $b(e){let t={},r=Dt(e,["text_det_limit_side_len","textDetLimitSideLen"],"text_det_limit_side_len");if(r!==void 0){let c=Pt(r);c!==void 0&&(t.text_det_limit_side_len=c)}let n=Dt(e,["text_det_limit_type","textDetLimitType"],"text_det_limit_type");n!==void 0&&bb(n)&&(t.text_det_limit_type=n);let s=Dt(e,["text_det_max_side_limit","textDetMaxSideLimit"],"text_det_max_side_limit");if(s!==void 0){let c=Pt(s);c!==void 0&&(t.text_det_max_side_limit=c)}let l=Dt(e,["text_det_thresh","textDetThresh"],"text_det_thresh");if(l!==void 0){let c=Pt(l);c!==void 0&&(t.text_det_thresh=c)}let a=Dt(e,["text_det_box_thresh","textDetBoxThresh"],"text_det_box_thresh");if(a!==void 0){let c=Pt(a);c!==void 0&&(t.text_det_box_thresh=c)}let d=Dt(e,["text_det_unclip_ratio","textDetUnclipRatio"],"text_det_unclip_ratio");if(d!==void 0){let c=Pt(d);c!==void 0&&(t.text_det_unclip_ratio=c)}let p=Dt(e,["text_rec_score_thresh","textRecScoreThresh"],"text_rec_score_thresh");if(p!==void 0){let c=Pt(p);c!==void 0&&(t.text_rec_score_thresh=c)}return t}function Ta(e){let t=Pt(e);return t!==void 0&&t>=1?Math.floor(t):void 0}function Cb(e){return{det:Ta(Dt(e,["textDetectionBatchSize","text_detection_batch_size"],"textDetectionBatchSize")),rec:Ta(Dt(e,["textRecognitionBatchSize","text_recognition_batch_size"],"textRecognitionBatchSize")),pipeline:Ta(Dt(e,["pipelineBatchSize","pipeline_batch_size","batch_size"],"pipelineBatchSize"))}}function Ib(e,t){let r=$b(t),n=Cb(t),s=F0(e);return s.runtimeDefaults=xb(s.runtimeDefaults,r),n.det!==void 0&&(s.textDetectionBatchSize=n.det),n.rec!==void 0&&(s.textRecognitionBatchSize=n.rec),n.pipeline!==void 0&&(s.pipelineBatchSize=n.pipeline),s}function Tb(e){return e==="ignore"||e==="error"?e:"warn"}function Sb(e,t){if(!(!e.length||t==="ignore")){if(t==="error")throw new Error(e.join(" "));for(let r of e)console.warn(`[PaddleOCR.js] ${r}`)}}function Sa(e,t){let r=O0[t];if(!r)throw new Error(`Unknown model asset "${t}".`);return{url:r.url}}function Pb(e,t,r,n){return r?.[n]??t?.[n]??e?.[n]??null}function Eb(e,t,r){return Object.fromEntries(za.map(n=>[n.selectionKey,Pb(e,t,r,n.selectionKey)]))}function E0(e,t,r){if(!t)throw new Error(`${e} model selection must define model_name.`);let n=Sw(r);if(!n)throw new Error(`${e} in inference.yml must define model_name.`);if(n!==t)throw new Error(`${e} in inference.yml declares model_name "${n}" but requested model_name is "${t}".`)}function Ab(e,t,r,n,s,l,a,d){let p=d?.[e];if(p)return p;let c=l?.[r];if(c)return Sa(t,c);let g=a?.[e];if(g)return g;let _=s?.[r];if(_)return Sa(t,_);let w=n?.[r];return w?Sa(t,w):null}function Ob(e,t,r,n,s){let l=Object.fromEntries(za.map(a=>[a.assetKey,Ab(a.assetKey,a.modelRole,a.selectionKey,e,t,r,n,s)]));if(Object.values(l).some(a=>!a))throw new Error("OCR model selection must define both detection and recognition models.");return l}function kb(e){let t={},r={},n=!1;for(let s of za){let l=Dt(e,s.nameAliases,s.nameLabel),a=Dt(e,s.assetAliases,s.assetLabel);if(l!==void 0&&(t[s.selectionKey]=l,n=!0),a!==void 0){if(l===void 0)throw new Error(s.assetRequirementError);r[s.assetKey]=a,n=!0}}return n?{modelSelection:t,assets:r}:null}function Nb(e,t=!1){let r=Dt(e,["ocrVersion","ocr_version"],"ocrVersion");if(!e.lang&&!r)return t?G0:null;let n=e.lang||"ch",s=r||"PP-OCRv5";if(s==="PP-OCRv6"){if(!vb(n))throw new Error(`Unsupported lang/ocrVersion combination: lang="${n}", ocrVersion="${s}".`);return mb}let l=wb.get(`${n}::${s}`);if(!l)throw new Error(`Unsupported lang/ocrVersion combination: lang="${n}", ocrVersion="${s}".`);return l}function Bb(e={}){let t=e.pipelineConfig,r=t!=null?N0(t):null,n=Tb(e.unsupportedBehavior),s=r?.warnings||[],l=Nb(e,!r),a=r?.modelSelection||null,d=r?.assets||null,p=kb(e),c=p?.modelSelection||null,g=p?.assets||null,_=Eb(l,a,c),w=Ob(l,a,c,d,g),C=r??Y0;r&&Sb(s,n);let x=Ib(C,e);return x.modelSelection=_,x.assets={...w},x}function Lb(e){return e==="webgpu"||e==="wasm"?e:"auto"}function Mb(e={}){return{backend:Lb(e.backend),...e.wasmPaths!==void 0?{wasmPaths:e.wasmPaths}:{},...e.numThreads!==void 0?{numThreads:e.numThreads}:{},...e.simd!==void 0?{simd:e.simd}:{},...e.proxy!==void 0?{proxy:e.proxy}:{}}}function Rb(e){if(!e)return{enabled:!1,createWorker:null};if(e===!0)return{enabled:!0,createWorker:null};if(typeof e=="object"){let t=e;return{enabled:!0,createWorker:typeof t.createWorker=="function"?t.createWorker:null}}throw new Error("worker must be a boolean or an options object.")}function Db(e={}){return{pipelineConfig:Bb(e),ortOptions:Mb(e.ortOptions||{})}}function H0(){return F0(hb)}function zb(){}function Fb(e){let t=e?.det,r=e?.rec;if(!t||typeof t!="object"||!r||typeof r!="object")throw new Error("PaddleOCRCore requires pre-resolved detection and recognition asset descriptors.");return{det:t,rec:r}}var Na=class{constructor(t){ct(this,"options"),ct(this,"modelConfig"),ct(this,"runtimeDefaults"),ct(this,"cv"),ct(this,"ort"),ct(this,"detModel"),ct(this,"recModel"),ct(this,"webgpuState"),ct(this,"pipelineConfig"),ct(this,"lastInitializationSummary"),ct(this,"ensureServedFromHttp"),ct(this,"sourceToMat"),this.options=t,this.modelConfig=H0(),this.pipelineConfig=t.pipelineConfig,this.runtimeDefaults={...t.pipelineConfig.runtimeDefaults},this.cv=null,this.ort=null,this.detModel=null,this.recModel=null,this.webgpuState={available:!1,reason:""},this.lastInitializationSummary=null,this.ensureServedFromHttp=t.ensureServedFromHttp||zb,this.sourceToMat=t.sourceToMat}async initialize(){this.ensureServedFromHttp();let t=Mi(),{cv:r}=await pb();this.cv=r;let{ort:n,webgpuState:s,backend:l}=await Iw(this.options.ortOptions||{});this.ort=n,this.webgpuState=s;let a=Fb(this.pipelineConfig.assets),d=this.options.fetch||fetch,p=await Promise.all([C0(a.det,d),C0(a.rec,d)]);E0("TextDetection",this.pipelineConfig.modelSelection.textDetectionModelName,p[0].configText),E0("TextRecognition",this.pipelineConfig.modelSelection.textRecognitionModelName,p[1].configText),await this.disposeModelsOnly();let c=this.pipelineConfig.textDetectionBatchSize,g=this.pipelineConfig.textRecognitionBatchSize,[_,w]=await Promise.all([Rw({ort:this.ort,modelBytes:p[0].modelBytes,configText:p[0].configText,backend:l,webgpuState:s,batchSize:c}),tb({ort:this.ort,modelBytes:p[1].modelBytes,configText:p[1].configText,backend:l,webgpuState:s,batchSize:g})]);this.detModel=_,this.recModel=w,this.modelConfig={det:this.detModel.config,rec:this.recModel.config};let C=Mi()-t;return this.lastInitializationSummary={backend:l,webgpuAvailable:s.available,detProvider:this.detModel.provider,recProvider:this.recModel.provider,assets:p.map(x=>x.download),elapsedMs:C,pipelineConfigWarnings:this.pipelineConfig.warnings},this.lastInitializationSummary}getInitializationSummary(){return this.lastInitializationSummary}getModelConfig(){return this.modelConfig}async predict(t,r={}){var n,s,l;if(!this.sourceToMat)throw new Error("PaddleOCR source adapter is not configured.");(!this.detModel||!this.recModel||!this.cv||!this.ort)&&await this.initialize();let a=this.cv,d=this.detModel,p=this.recModel;if(!a||!d||!p)throw new Error("Initialization did not complete. Call initialize() first.");let c=Array.isArray(t)?t:[t],g=this.sourceToMat,_=Math.max(1,Math.floor(this.pipelineConfig.pipelineBatchSize)||1),w=Ra(c,_),C=Mi(),x=cb(this.modelConfig,this.runtimeDefaults,r),S=0,N=0,E=[];for(let L of w){let M=await Promise.all(L.map(F=>Promise.resolve(g(a,F))));try{let F=Mi(),U=await d.predict(a,M.map(oe=>oe.mat),x.det);S+=Mi()-F;let k=Mi(),re=[];for(let oe=0;oe<U.length;oe+=1){let ye=((n=U[oe])==null?void 0:n.boxes)??[],fe=[];for(let ce=0;ce<ye.length;ce+=1)fe.push(ub(a,M[oe].mat,ye[ce].poly));try{let ce=fe.length?await p.predict(a,fe):[],$e=[];for(let q=0;q<ce.length;q+=1){let Y=ce[q];Y.text&&Y.score>=x.pipeline.scoreThresh&&$e.push({poly:ye[q].poly,text:Y.text,score:Y.score})}re.push($e)}finally{for(let ce of fe)ce.delete()}}N+=Mi()-k;for(let oe=0;oe<M.length;oe+=1){let ye=M[oe],fe=((s=U[oe])==null?void 0:s.boxes)??[],ce=re[oe]??[];E.push({image:{width:ye.width,height:ye.height},items:ce,detectedBoxes:fe.length,recognizedCount:ce.length})}}finally{for(let F of M)F.dispose()}}let T=Mi()-C,B=((l=this.options.ortOptions)==null?void 0:l.backend)??"auto";return E.map(L=>({image:L.image,items:L.items,metrics:{detMs:S,recMs:N,totalMs:T,detectedBoxes:L.detectedBoxes,recognizedCount:L.recognizedCount},runtime:{requestedBackend:B,detProvider:d.provider,recProvider:p.provider,webgpuAvailable:this.webgpuState.available}}))}async disposeModelsOnly(){var t,r;await Promise.all([(t=this.detModel)==null?void 0:t.dispose(),(r=this.recModel)==null?void 0:r.dispose()]),this.detModel=null,this.recModel=null}async dispose(){await this.disposeModelsOnly()}},Ub="worker-transport-request",qb="worker-transport-response";function Wb(e,t,r){return{kind:Ub,type:e,payload:t,requestId:r}}function Xb(e){return typeof e=="object"&&e!==null&&"kind"in e&&e.kind===qb}function Yb(e){let t=e||{},r=new Error(t.message||"Unknown worker error.");return r.name=t.name||"Error",t.stack&&(r.stack=t.stack),r}var Ba=class{constructor(t={}){ct(this,"workerOptions"),ct(this,"worker"),ct(this,"pending"),ct(this,"nextRequestId"),ct(this,"disposed"),this.workerOptions=t,this.worker=null,this.pending=new Map,this.nextRequestId=1,this.disposed=!1}ensureActive(){if(this.disposed)throw new Error("Worker transport client has been disposed.")}ensureWorker(){if(this.ensureActive(),this.worker)return this.worker;let t=this.workerOptions.createWorker;if(typeof t!="function")throw new Error("Worker transport client requires a createWorker() factory.");let r=t();return r.onmessage=n=>{let s=n.data;if(!Xb(s))return;let l=this.pending.get(s.requestId);l&&(this.pending.delete(s.requestId),s.status==="success"?l.resolve(s.payload):l.reject(Yb(s.error)))},r.onerror=n=>{let s=new Error(n.message||"OCR worker failed.");for(let l of this.pending.values())l.reject(s);this.pending.clear()},this.worker=r,r}request(t,r,n=[]){let s=this.ensureWorker(),l=this.nextRequestId;return this.nextRequestId+=1,new Promise((a,d)=>{this.pending.set(l,{resolve:a,reject:d}),s.postMessage(Wb(t,r,l),n)})}disposeWorker(){this.worker&&(this.worker.terminate(),this.worker=null)}dispose(){if(!this.disposed){this.disposed=!0;for(let t of this.pending.values())t.reject(new Error("Worker transport client has been disposed."));this.pending.clear(),this.disposeWorker()}}};function Gb(e){return new Ba(e)}function Hb(){if(typeof Worker!="function")throw new Error("worker mode requires Web Worker support in this environment.");return(()=>{let e=new URL("./assets/worker-entry-C9UNuyOJ.js",jb.url);return new Worker(e,{type:"module"})})()}var La=class{constructor(t,r){ct(this,"options"),ct(this,"lastInitializationSummary"),ct(this,"modelConfig"),ct(this,"transportClient"),ct(this,"initPromise"),ct(this,"disposed"),this.options=t,this.lastInitializationSummary=null,this.modelConfig=H0(),this.transportClient=r,this.initPromise=null,this.disposed=!1}ensureActive(){if(this.disposed)throw new Error("PaddleOCR worker instance has been disposed.")}async initialize(){if(this.ensureActive(),this.lastInitializationSummary)return this.lastInitializationSummary;if(!this.initPromise){let t=this.options.ortOptions||{};t.wasmPaths===void 0&&console.warn('[PaddleOCR.js] Worker mode: ortOptions.wasmPaths is not set \u2014 falling back to CDN (%s). For version consistency between main thread and worker, set ortOptions.wasmPaths to the path where your bundler outputs the onnxruntime-web WASM files (e.g. ortOptions: { wasmPaths: "/assets/" }).',"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/");let r=t.wasmPaths===void 0?{wasmPaths:"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/"}:{};this.initPromise=this.transportClient.request("init",{options:{...this.options,ortOptions:{...t,...r,disableWasmProxy:!0}}}).then(n=>{let s=n;return this.lastInitializationSummary=s.summary,this.modelConfig=s.modelConfig,this.lastInitializationSummary}).catch(n=>{throw this.initPromise=null,this.transportClient.dispose(),n})}return this.initPromise}getInitializationSummary(){return this.lastInitializationSummary}getModelConfig(){return this.modelConfig}async predict(t,r={}){this.ensureActive(),await this.initialize();let n=Array.isArray(t)?t:[t],s=await Promise.all(n.map(d=>bw(d))),l=s.map(d=>d.payload),a=s.flatMap(d=>d.transferables);return this.transportClient.request("predict",{sources:l,params:r},a)}async dispose(){if(!this.disposed){this.disposed=!0;try{await this.transportClient.request("dispose",{})}catch{}this.transportClient.dispose()}}};function Vb(e,t={}){let r=Gb({...t,createWorker:t.createWorker||Hb});return new La(e,r)}var Dn=class e extends Na{constructor(t){super({...t,ensureServedFromHttp:yw,sourceToMat:ww})}static async create(t={}){let r=Rb(t.worker);if(r.enabled&&t.fetch)throw new Error("worker mode does not support a custom fetch implementation.");let n=Db(t),s=r.enabled?Vb(n,{createWorker:r.createWorker??void 0}):new e({...n,fetch:t.fetch});return t.initialize!==!1&&await s.initialize(),s}};globalThis.LitPaddleOcr={PaddleOCR:Dn};})();
/*! Bundled license information:

onnxruntime-web/dist/ort.bundle.min.mjs:
  (*!
   * ONNX Runtime Web v1.30.0
   * Copyright (c) Microsoft Corporation. All rights reserved.
   * Licensed under the MIT License.
   *)
  (**
   * @license
   * Copyright 2021 Google LLC. All Rights Reserved.
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   * http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   * =============================================================================
   *)
  (**
   * @license
   * Copyright 2020 Google LLC. All Rights Reserved.
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   * http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   * =============================================================================
   *)
  (**
   * @license
   * Copyright 2019 Google LLC. All Rights Reserved.
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   * http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   * =============================================================================
   *)
*/
