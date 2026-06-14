import { ArrowRight, BookOpen, Bot, Chrome, Download, FileText, Gauge, Github, LockKeyhole, MousePointer2, ScrollText, ShieldCheck, Sparkles, Terminal, Waypoints } from 'lucide-react'

const links = {
  github: 'https://github.com/name718/browser-bridge',
  tutorial: 'https://github.com/name718/browser-bridge#快速开始',
  extensionZip: 'https://github.com/name718/browser-bridge/raw/main/release/browser-bridge-extension-0.4.0.zip',
}

const features = [
  {
    icon: MousePointer2,
    title: '点穴',
    desc: '用语义定位按钮、输入框与菜单，Agent 不必先吞下整页 DOM。',
  },
  {
    icon: ScrollText,
    title: '观卷',
    desc: '抽取页面文本、表单、表格、链接和可交互元素，低 token 看清局势。',
  },
  {
    icon: Gauge,
    title: '听风',
    desc: '通过 CDP 监听网络、控制台与性能指标，慢请求和异常无处遁形。',
  },
  {
    icon: LockKeyhole,
    title: '护心',
    desc: '高风险动作触发确认与审计，允许自动化但不放弃控制权。',
  },
]

const tools = [
  'browser_get_page_model',
  'browser_find',
  'browser_act',
  'browser_screenshot',
  'browser_cdp_session',
  'browser_qa_run',
]

const architecture = [
  ['AI Client', 'Claude / Cursor / Codex'],
  ['MCP Server', '本地调度与安全边界'],
  ['Chrome Extension', '真实浏览器与登录态'],
]

const journeys = [
  ['夜探页面', '打开真实 Chrome，抽取页面模型、表单、表格和关键交互。'],
  ['飞身点穴', '按按钮文本、placeholder、role 或视觉文字定位，直接点击与输入。'],
  ['听风辨脉', '监听 Network、Runtime、Performance，排查慢接口和前端异常。'],
  ['留影成册', '生成截图、PDF、QA report 和 replay，方便复盘与交付。'],
]

const flow = [
  ['观', 'browser_get_page_model', '先取低 token 页面卷宗。'],
  ['寻', 'browser_find / browser_act', '按语义找目标，不硬背选择器。'],
  ['行', 'browser_run_steps', '多步操作、断言、截图一次落子。'],
  ['证', 'browser_qa_report', '报告、回放、日志留痕。'],
]

function App() {
  return (
    <main className="page-shell">
      <div className="ink-orb ink-orb-a" />
      <div className="ink-orb ink-orb-b" />
      <div className="floating-ink ink-1" />
      <div className="floating-ink ink-2" />
      <div className="floating-ink ink-3" />
      <nav className="nav">
        <a className="brand" href="#top" aria-label="Browser Bridge 首页">
          <span className="brand-seal">桥</span>
          <span>Browser Bridge</span>
        </a>
        <div className="nav-links">
          <a href="#features">招式</a>
          <a href="#journey">路书</a>
          <a href="#architecture">阵法</a>
          <a href="#install">入门</a>
          <a href={links.github} target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </nav>

      <section id="top" className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Model Context Protocol · Chrome 真身</p>
          <h1>
            墨入浏览器
            <span>剑起 Agent</span>
          </h1>
          <p className="lead">
            Browser Bridge 让 AI 代理穿过 MCP 之桥，操控你已登录的真实 Chrome。
            不另起无头江湖，不重登账号，直接在当下页面读、点、写、测。
          </p>
          <div className="hero-actions">
            <a className="primary-button" href="#install">
              开卷入门 <ArrowRight size={18} />
            </a>
            <a className="ghost-button" href={links.extensionZip}>
              下载插件 <Download size={18} />
            </a>
            <a className="ghost-button" href={links.github} target="_blank" rel="noreferrer">
              GitHub <Github size={18} />
            </a>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="ink-ring ring-a" />
          <div className="ink-ring ring-b" />
          <div className="sword-flash" />
          <div className="moon" />
          <div className="mountain mountain-back" />
          <div className="mountain mountain-mid" />
          <div className="mountain mountain-front" />
          <div className="sword">
            <span />
          </div>
          <div className="paper-card">
            <span className="card-title">江湖命令</span>
            <code style={{ '--line': 0 } as React.CSSProperties}>browser_act(&#123; action: "click", target: "登录" &#125;)</code>
            <code style={{ '--line': 1 } as React.CSSProperties}>browser_get_page_model(&#123; viewportOnly: true &#125;)</code>
            <code style={{ '--line': 2 } as React.CSSProperties}>browser_cdp_session(&#123; enable: ["Network"] &#125;)</code>
          </div>
        </div>
      </section>

      <section id="journey" className="journey">
        <div className="vertical-title">
          <span>江湖路书</span>
        </div>
        <div className="journey-copy">
          <p className="eyebrow">真实浏览器 · 连招场景</p>
          <h2>从探页到留证，一条龙走完。</h2>
          <p>
            Browser Bridge 的核心不是“能点一下”，而是让 Agent 在真实登录态中持续观察、判断、执行、记录。
          </p>
        </div>
        <div className="journey-grid">
          {journeys.map(([title, desc], index) => (
            <article key={title} className="journey-card" style={{ '--delay': `${index * 110}ms` } as React.CSSProperties}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{title}</h3>
              <p>{desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="features" className="section">
        <div className="section-heading">
          <p>四式成章</p>
          <h2>不是模拟浏览器，是借你手中真浏览器出招。</h2>
        </div>
        <div className="feature-grid">
          {features.map((feature, index) => {
            const Icon = feature.icon
            return (
              <article className="feature-card" key={feature.title} style={{ '--delay': `${index * 90}ms` } as React.CSSProperties}>
                <Icon size={24} />
                <h3>{feature.title}</h3>
                <p>{feature.desc}</p>
              </article>
            )
          })}
        </div>
      </section>

      <section className="flow-scroll">
        <div className="scroll-rod left" />
        <div className="scroll-rod right" />
        <div className="flow-heading">
          <p className="eyebrow">卷轴流程</p>
          <h2>一卷展开，四步成局。</h2>
        </div>
        <div className="flow-steps">
          {flow.map(([mark, title, desc], index) => (
            <article key={mark} className="flow-step" style={{ '--delay': `${index * 120}ms` } as React.CSSProperties}>
              <strong>{mark}</strong>
              <code>{title}</code>
              <p>{desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="scroll-panel">
        <div>
          <p className="eyebrow">低 Token 工具体系</p>
          <h2>先观其势，再落其子。</h2>
          <p>
            从页面模型、可交互元素、截图、PDF 到 CDP 深层分析，Agent 可以按任务选择最省上下文的路径。
          </p>
        </div>
        <div className="tool-cloud">
          {tools.map((tool, index) => (
            <span key={tool} style={{ '--delay': `${index * 90}ms` } as React.CSSProperties}>{tool}</span>
          ))}
        </div>
      </section>

      <section id="architecture" className="section architecture">
        <div className="section-heading">
          <p>三才阵法</p>
          <h2>Agent、MCP、Chrome 各守其位。</h2>
        </div>
        <div className="arch-line">
          {architecture.map(([title, desc], index) => (
            <article className="arch-node" key={title}>
              <span>0{index + 1}</span>
              <h3>{title}</h3>
              <p>{desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="install" className="install">
        <div className="install-copy">
          <p className="eyebrow">两步开局</p>
          <h2>起本地桥，连 Chrome 扩展。</h2>
          <p>适合页面分析、自动化回归、登录态操作、前端调试和 AI QA 报告。</p>
          <div className="install-badges">
            <span><ShieldCheck size={16} /> 本地优先</span>
            <span><Sparkles size={16} /> 低 Token</span>
          </div>
          <div className="resource-actions">
            <a href={links.extensionZip}>
              <Download size={18} /> 下载 Chrome 插件 v0.4.0
            </a>
            <a href={links.tutorial} target="_blank" rel="noreferrer">
              <BookOpen size={18} /> 阅读安装教程
            </a>
            <a href={links.github} target="_blank" rel="noreferrer">
              <Github size={18} /> 查看 GitHub 仓库
            </a>
          </div>
        </div>
        <div className="terminal">
          <div><Terminal size={16} /> bash</div>
          <code># 先下载并加载 release/browser-bridge-extension-0.4.0.zip</code>
          <code>pnpm install</code>
          <code>pnpm dev:daemon</code>
          <code>pnpm build:extension</code>
        </div>
      </section>

      <section className="resources">
        <article>
          <span><Github size={20} /></span>
          <h3>GitHub 仓库</h3>
          <p>查看源码、提交 Issue、追踪 Roadmap 与 Release。</p>
          <a href={links.github} target="_blank" rel="noreferrer">github.com/name718/browser-bridge</a>
        </article>
        <article>
          <span><Download size={20} /></span>
          <h3>插件下载</h3>
          <p>当前版本暂未上架 Chrome Web Store，请下载 zip 后手动加载。</p>
          <a href={links.extensionZip}>browser-bridge-extension-0.4.0.zip</a>
        </article>
        <article>
          <span><BookOpen size={20} /></span>
          <h3>安装教程</h3>
          <p>从加载插件、配置 MCP 客户端到连接本地 daemon，一步步照做。</p>
          <a href={links.tutorial} target="_blank" rel="noreferrer">README 快速开始</a>
        </article>
      </section>

      <footer className="footer">
        <div>
          <span className="brand-seal">桥</span>
          <strong>Browser Bridge</strong>
        </div>
        <div className="footer-links">
          <p>
            <Bot size={16} /> Agent 持剑
            <Waypoints size={16} /> MCP 架桥
            <Chrome size={16} /> Chrome 入局
            <FileText size={16} /> 报告留痕
          </p>
          <p>
            <a href={links.github} target="_blank" rel="noreferrer">GitHub</a>
            <a href={links.extensionZip}>插件下载</a>
            <a href={links.tutorial} target="_blank" rel="noreferrer">教程</a>
          </p>
        </div>
      </footer>
    </main>
  )
}

export default App
