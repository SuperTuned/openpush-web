/**
 * The prompt style. OpenPush's design language: square, flat, warm paper,
 * hard ink, one-pixel rules, no shadows. Type uses only the console scale (15/600 heading,
 * 13.5/400 body, 12/400 small) in the visitor's system font; nothing is downloaded. Every prompt
 * has its own shadow root with one `<style>` holding this text.
 */
const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

const TOKENS = `--op-ink:#0A0A0A;--op-ink2:#565651;--op-faint:#767470;--op-paper:#F7F5F1;--op-paper2:#EFEDE7;--op-rule:rgba(10,10,10,.13);--op-line:rgba(10,10,10,.22);--op-coral:#FF4E64`;

const COMMON = `
*,*::before,*::after{box-sizing:border-box}
button,input{font:inherit;color:inherit;margin:0}
@media (prefers-reduced-motion:reduce){.card,.bar{animation:none}}
`;

/** Floating prompts: slide-in, email or phone, bell, verify bar. */
export const FLOAT_CSS = `
:host{all:initial;position:fixed;z-index:2147483000;font-family:${FONT};font-size:13.5px;font-weight:400;line-height:1.5;color:#0A0A0A;${TOKENS}}
${COMMON}
:host([hidden]){display:none}
.card{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px 12px;width:min(420px,calc(100vw - 32px));padding:14px 16px;background:var(--op-paper);border:1px solid var(--op-ink);text-align:start;animation:op-in .18s ease-out}
.card.no-icon{grid-template-columns:minmax(0,1fr)}
.icon{width:36px;height:36px;display:block;object-fit:cover}
.body{min-width:0;display:grid;gap:7px;align-content:start}
.msg{margin:0;font-size:15px;font-weight:600;line-height:1.1;letter-spacing:-.02em;overflow-wrap:anywhere}
.small{margin:0;font-size:12px;line-height:1.5;color:var(--op-ink2);overflow-wrap:anywhere}
.full{grid-column:1/-1}
.actions{grid-column:1/-1;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}
.btn{min-height:38px;padding:8px 15px;border:1.5px solid var(--op-line);border-radius:0;background:transparent;color:var(--op-ink);line-height:1.5;cursor:pointer}
.btn:hover{background:var(--op-ink);border-color:var(--op-ink);color:var(--op-paper)}
.btn.pri{background:var(--op-ink);border-color:var(--op-ink);color:var(--op-paper)}
.btn.pri:hover{background:#000;border-color:#000}
.btn:active{transform:translateY(1px)}
.btn[disabled]{opacity:.45;cursor:default;transform:none}
.btn:focus-visible,.x:focus-visible,.bell:focus-visible,.check input:focus-visible{outline:2px solid var(--op-ink);outline-offset:2px}
.topics{display:grid;gap:7px;margin:0;padding:0;border:0;min-width:0}
.check{display:flex;align-items:center;gap:8px;cursor:pointer;overflow-wrap:anywhere}
.check input{width:16px;height:16px;flex:none;accent-color:var(--op-ink);cursor:pointer}
.steps{margin:0;padding-inline-start:20px;display:grid;gap:3px}
.field{display:grid;gap:3px}
.lbl{font-size:12px;line-height:1.5;color:var(--op-ink2)}
.inp{width:100%;min-width:0;padding:9px 11px;border:1.5px solid var(--op-line);border-radius:0;background:var(--op-paper);color:var(--op-ink);line-height:1.5}
.inp:focus{outline:none;border-color:var(--op-ink)}
.inp::placeholder{color:var(--op-faint)}
.err{min-height:18px;margin:0;font-size:12px;line-height:1.5;color:var(--op-ink)}
.err:not(:empty){border-inline-start:3px solid var(--op-coral);padding-inline-start:7px}
.x{position:absolute;top:7px;inset-inline-end:7px;width:32px;height:32px;display:grid;place-items:center;padding:0;border:0;background:transparent;color:var(--op-ink2);cursor:pointer}
.x:hover{color:var(--op-ink)}
.x svg,.bell svg{fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:square}
.x svg{width:16px;height:16px}
.rel{position:relative}
:host(.top){top:16px;left:50%;transform:translateX(-50%)}
:host(.bottom){bottom:16px;left:50%;transform:translateX(-50%)}
@media (max-width:640px){
:host(.top),:host(.bottom){top:auto;bottom:0;left:0;right:0;transform:none}
:host(.top) .card,:host(.bottom) .card{width:100%;border-width:1px 0 0;padding-bottom:calc(14px + env(safe-area-inset-bottom,0px));animation-name:op-up}
:host(.bellhost.hold){display:none}
.actions .btn{flex:1 1 auto}
}
@keyframes op-in{from{opacity:0;transform:translateY(-8px)}}
@keyframes op-up{from{opacity:0;transform:translateY(8px)}}
:host(.vbar){top:0;left:0;right:0}
.bar{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 52px 10px 16px;background:var(--op-ink);color:var(--op-paper);animation:op-in .18s ease-out}
.bar[dir=rtl]{padding:10px 16px 10px 52px}
.bar .t{flex:1 1 220px;margin:0;overflow-wrap:anywhere}
.bar .btn.pri{background:var(--op-paper);border-color:var(--op-paper);color:var(--op-ink)}
.bar .btn.pri:hover{background:var(--op-paper2);border-color:var(--op-paper2)}
.bar .x{top:50%;margin-top:-16px;color:var(--op-paper)}
.bar .x:focus-visible,.bar .btn:focus-visible{outline-color:var(--op-paper)}
:host(.bellhost){bottom:var(--op-b,16px);right:var(--op-s,16px)}
:host(.bellhost.left){right:auto;left:var(--op-s,16px)}
.bellwrap{position:relative}
.bell{width:var(--op-z,44px);height:var(--op-z,44px);display:grid;place-items:center;padding:0;border:0;border-radius:0;background:var(--op-main,#0A0A0A);color:var(--op-accent,#F7F5F1);cursor:pointer}
.bell svg{width:46%;height:46%}
.bell.blocked{opacity:.45}
.tip{position:absolute;bottom:50%;transform:translateY(50%);right:calc(100% + 10px);display:none;padding:3px 10px;background:var(--op-ink);color:var(--op-paper);font-size:12px;line-height:1.5;white-space:nowrap}
:host(.left) .tip{right:auto;left:calc(100% + 10px)}
.bell:hover+.tip,.bell:focus-visible+.tip,.tip.show{display:block}
.dialog{position:absolute;bottom:calc(100% + 10px);right:0;width:min(300px,calc(100vw - 32px));display:grid;gap:10px;padding:14px 16px;background:var(--op-paper);border:1px solid var(--op-ink);text-align:start}
:host(.left) .dialog{right:auto;left:0}
.dialog .msg{padding-inline-end:28px}
`;

/** Placed buttons: the host is the site's own element, so only its documented classes style it. */
export const BUTTON_CSS = `
:host{${TOKENS}}
${COMMON}
.pbwrap{display:inline-block;font-family:${FONT};font-size:13.5px;font-weight:400;line-height:1.5}
.pb{min-height:38px;padding:8px 15px;border:1.5px solid var(--pb-bg,#0A0A0A);border-radius:0;background:var(--pb-bg,#0A0A0A);color:var(--pb-text,#F7F5F1);line-height:1.5;cursor:pointer}
.pb:hover{opacity:.88}
.pb[disabled]{opacity:.45;cursor:default}
.pb.small{min-height:32px;padding:3px 12px;font-size:12px}
.pb.large{min-height:44px;padding:10px 16px;font-size:15px;font-weight:600;line-height:1.1;letter-spacing:-.02em}
.pb.link{min-height:0;padding:0;border:0;background:none;color:var(--pb-text,#0A0A0A);text-decoration:underline;text-underline-offset:3px}
.pb:focus-visible{outline:2px solid var(--op-ink);outline-offset:2px}
.note{display:block;margin-top:7px;font-size:12px;line-height:1.5;color:var(--op-ink2)}
`;
