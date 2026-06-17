import { AlertTriangle, Bot, Check, ChevronDown, Circle, Copy, Loader2, MessageSquarePlus, Pause, RotateCcw, Send, Sparkles, Square, Terminal, Trash2, Wrench, XCircle } from "lucide-react";

const conversations = [
  { title: "Streaming response notes", time: "2 min", active: true, streaming: true },
  { title: "Markdown renderer draft", time: "18 min", active: false, streaming: true },
  { title: "Tool call contract", time: "Today", active: false, streaming: false },
  { title: "Error retry behavior", time: "Yesterday", active: false, streaming: false },
  { title: "Assistant profile switch", time: "Jun 16", active: false, streaming: true },
];

const examples = ["解释一下什么是流式响应", "帮我写一个简单的 Markdown 示例", "现在几点？顺便算一下 599 * 3"];

type ToolState = "running" | "success" | "failed";

function StatusBadge({ label, tone = "neutral" }: { label: string; tone?: "stream" | "success" | "failed" | "aborted" | "neutral" }) {
  const styles = {
    stream: "border-sky-200 bg-sky-50 text-sky-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    failed: "border-red-200 bg-red-50 text-red-700",
    aborted: "border-amber-200 bg-amber-50 text-amber-700",
    neutral: "border-border bg-white text-muted-foreground",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${styles[tone]}`}>{label}</span>;
}

function ConversationItem({ item }: { item: typeof conversations[number] }) {
  return (
    <div className={`rounded-xl border p-3 transition ${item.active ? "border-slate-300 bg-white shadow-sm" : "border-transparent hover:border-border hover:bg-white/70"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-sidebar-foreground">{item.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{item.time}</p>
        </div>
        {item.streaming && <span className="mt-0.5 flex h-2.5 w-2.5 rounded-full bg-sky-500 shadow-[0_0_0_4px_rgba(14,165,233,0.14)]" />}
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-sidebar p-4">
      <div className="flex items-center gap-2 px-1 py-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Bot size={19} /></div>
        <div><h1 className="text-base font-bold leading-tight">AIChatAssistant</h1><p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Vue-ready MVP</p></div>
      </div>
      <button className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm"><MessageSquarePlus size={16} /> 新建会话</button>
      <div className="mt-5 flex-1 space-y-2 overflow-hidden"><p className="px-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Conversations</p>{conversations.map((c) => <ConversationItem key={c.title} item={c} />)}</div>
      <div className="rounded-xl border border-border bg-white p-3 text-xs text-muted-foreground"><div className="mb-1 flex items-center gap-2 font-semibold text-foreground"><Circle size={8} className="fill-emerald-500 text-emerald-500" /> Local MVP / Mock Mode</div>3 conversations streaming independently</div>
    </aside>
  );
}

function Header() {
  return <header className="flex h-16 items-center justify-between border-b border-border bg-white/80 px-6 backdrop-blur"><div className="flex items-center gap-3"><button className="flex items-center gap-3 rounded-xl border border-border bg-white px-3 py-2 shadow-sm"><Sparkles size={16} className="text-sky-600" /><div className="text-left"><p className="text-sm font-semibold">general</p><p className="text-xs text-muted-foreground">日常问答、代码解释、普通聊天</p></div><ChevronDown size={16} /></button><StatusBadge label="mode: chat" /><StatusBadge label="Mock Stream" tone="stream" /></div><button className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground"><Trash2 size={15} /> 清空当前会话</button></header>;
}

function CodeBlock() {
  return <div className="mt-3 overflow-hidden rounded-xl border border-slate-800 bg-[#111827] text-slate-100"><div className="flex items-center justify-between border-b border-white/10 px-3 py-2 font-mono text-xs"><span>typescript</span><button className="flex items-center gap-1 text-slate-300"><Copy size={13} /> Copy</button></div><pre className="overflow-hidden p-4 font-mono text-xs leading-6"><code>{`type StreamState = "idle" | "running" | "failed" | "aborted";\n\nfunction canStart(state: StreamState) {\n  return state !== "running";\n}`}</code></pre></div>;
}

function ToolCallCard({ name, state }: { name: string; state: ToolState }) {
  const meta = { running: ["running", "stream", <Loader2 className="animate-spin" size={15} />], success: ["success", "success", <Check size={15} />], failed: ["failed", "failed", <XCircle size={15} />] } as const;
  return <div className="mt-3 rounded-xl border border-border bg-slate-50 p-3"><div className="flex items-center justify-between"><div className="flex items-center gap-2 font-semibold"><Wrench size={16} className="text-sky-600" /> {name}</div><span className={`flex items-center gap-1 text-xs ${state === "failed" ? "text-red-700" : state === "success" ? "text-emerald-700" : "text-sky-700"}`}>{meta[state][2]} {meta[state][0]}</span></div><div className="mt-2 grid grid-cols-[90px_1fr] gap-y-1 font-mono text-xs text-muted-foreground"><span>params</span><span>{name === "calculator" ? "expression: 599 * 3" : "timezone: UTC, format: ISO"}</span><span>result</span><span className={state === "failed" ? "text-red-700" : "text-foreground"}>{state === "running" ? "waiting for tool response…" : state === "success" ? "1797" : "Tool timeout after 8s"}</span></div></div>;
}

function Message({ role, state = "normal", tools = false }: { role: "user" | "assistant"; state?: "normal" | "stream" | "failed" | "aborted"; tools?: boolean }) {
  const user = role === "user";
  return <div className={`flex ${user ? "justify-end" : "justify-start"}`}><div className={`max-w-[720px] rounded-2xl border px-4 py-3 ${user ? "border-slate-900 bg-slate-900 text-white" : "border-border bg-white text-foreground shadow-sm"}`}><div className="mb-2 flex items-center gap-2 text-xs font-semibold opacity-80">{user ? "You" : "Assistant"}{state === "stream" && <StatusBadge label="streaming" tone="stream" />}{state === "failed" && <StatusBadge label="failed" tone="failed" />}{state === "aborted" && <StatusBadge label="已停止" tone="aborted" />}</div>{user ? <p>帮我说明这个聊天底座应该如何处理流式响应和代码块。</p> : <div className="space-y-2 text-sm leading-7"><p><strong>流式响应</strong>适合把 assistant message 拆成可追加的 token chunk，并在会话级别维护 running 状态。</p><ul className="list-disc pl-5"><li>同一 conversation 不允许并发生成。</li><li>不同 conversation 可以同时 streaming。</li><li>停止只影响当前 conversation 的当前 assistant message。</li></ul><CodeBlock />{tools && <><ToolCallCard name="currentTime" state="running" /><ToolCallCard name="calculator" state="success" /><ToolCallCard name="mockWeather" state="failed" /></>}{state === "stream" && <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-sky-500 align-middle" />}{state === "failed" && <ErrorRetry failed />}{state === "aborted" && <ErrorRetry />}</div>}</div></div>;
}

function ErrorRetry({ failed = false }: { failed?: boolean }) { return <div className={`mt-3 flex items-center justify-between rounded-xl border p-3 ${failed ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}><span className="flex items-center gap-2 text-sm">{failed ? <AlertTriangle size={16}/> : <Pause size={16}/>} {failed ? "生成失败，请稍后重试" : "已停止，保留当前已生成内容"}</span><button className="flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold shadow-sm"><RotateCcw size={13}/> 重试</button></div> }

function EmptyState() { return <div className="flex h-full items-center justify-center p-10"><div className="max-w-2xl text-center"><div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-200 bg-indigo-50 text-sky-600"><Terminal size={24}/></div><h2 className="text-3xl font-bold tracking-[-0.01em]">开始一次 AI 对话</h2><p className="mt-2 text-muted-foreground">发送消息后，Assistant 将以流式方式回复</p><div className="mt-8 grid grid-cols-3 gap-3">{examples.map((e)=><div key={e} className="rounded-2xl border border-border bg-white p-4 text-left text-sm shadow-sm">{e}</div>)}</div></div></div> }

function Input({ streaming = false }: { streaming?: boolean }) { return <div className="border-t border-border bg-white p-4"><div className="mx-auto max-w-4xl rounded-2xl border border-border bg-input-background p-3 shadow-sm"><textarea disabled={streaming} className="h-16 w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60" placeholder={streaming ? "当前会话正在生成中，可停止后继续输入" : "输入消息，开始一次流式对话"} /><div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">Enter 发送 · Shift + Enter 换行</p><button className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white ${streaming ? "bg-slate-800" : "bg-primary"}`}>{streaming ? <><Square size={14}/> 停止</> : <><Send size={14}/> 发送</>}</button></div></div></div> }

function ChatFrame({ title, children, streaming = false }: { title: string; children: React.ReactNode; streaming?: boolean }) { return <section className="overflow-hidden rounded-[24px] border border-border bg-background shadow-xl"><div className="border-b border-border bg-white px-5 py-3 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Frame · {title}</div><div className="flex h-[760px]"><Sidebar/><main className="flex min-w-0 flex-1 flex-col"><Header/><div className="flex-1 overflow-hidden p-6"><div className="mx-auto flex max-w-4xl flex-col gap-5">{children}</div></div><Input streaming={streaming}/></main></div></section> }

export default function App() {
  return <div className="min-h-full bg-[linear-gradient(90deg,#f1f3f8_0_18%,#f7f8fb_18%)] p-8 text-foreground"><div className="mx-auto max-w-[1440px]"><div className="mb-8 flex items-end justify-between"><div><p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">Editable Figma design system</p><h1 className="mt-2 text-4xl font-extrabold tracking-[-0.01em] text-slate-950">AIChatAssistant Web App</h1><p className="mt-2 max-w-2xl text-muted-foreground">干净、工程感、可拆 Vue 组件的 AI Chat MVP 设计稿，覆盖会话、流式、工具调用与异常状态。</p></div><div className="flex gap-2"><StatusBadge label="1440×900 desktop"/><StatusBadge label="Auto Layout ready" tone="stream"/></div></div><div className="grid gap-8"><ChatFrame title="01 空会话状态"><EmptyState/></ChatFrame><ChatFrame title="02 正常对话状态"><Message role="user"/><Message role="assistant"/></ChatFrame><ChatFrame title="03 Streaming 状态" streaming><Message role="user"/><Message role="assistant" state="stream"/></ChatFrame><ChatFrame title="04 Tool Call 状态"><Message role="user"/><Message role="assistant" tools/></ChatFrame><ChatFrame title="05 Failed 状态"><Message role="assistant" state="failed"/></ChatFrame><ChatFrame title="06 Aborted 状态"><Message role="assistant" state="aborted"/></ChatFrame><ChatFrame title="07 多会话同时 Streaming"><div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><strong>规则展示：</strong>当前会话正在生成时输入区显示停止；左侧另有多个会话生成中，但不影响当前浏览。停止按钮只停止当前 Conversation 的当前 assistant message。</div><Message role="assistant" state="stream"/></ChatFrame></div></div></div>;
}
