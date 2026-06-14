import React, { useState, useEffect } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { 
  Chrome, 
  Cpu, 
  ShieldCheck, 
  Zap, 
  Terminal, 
  Github, 
  ChevronRight,
  Layers,
  MousePointer2,
  Eye
} from 'lucide-react';
import { TypeAnimation } from 'react-type-animation';

const Navbar = () => (
  <nav className="fixed top-0 w-full z-50 glass px-6 py-4 flex justify-between items-center">
    <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
      <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
        <Layers size={18} />
      </div>
      <span>Browser Bridge</span>
    </div>
    <div className="hidden md:flex gap-8 text-sm text-slate-400 font-medium">
      <a href="#features" className="hover:text-white transition-colors">特性</a>
      <a href="#architecture" className="hover:text-white transition-colors">架构</a>
      <a href="#install" className="hover:text-white transition-colors">安装</a>
    </div>
    <a href="https://github.com" className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded-full text-sm font-bold hover:bg-slate-200 transition-colors">
      <Github size={16} />
      <span>GitHub</span>
    </a>
  </nav>
);

const FeatureCard = ({ icon: Icon, title, desc, delay }: any) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    transition={{ duration: 0.5, delay }}
    className="glass p-8 rounded-2xl hover:border-blue-500/50 transition-colors group relative overflow-hidden"
  >
    <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    <div className="w-12 h-12 bg-blue-600/20 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
      <Icon className="text-blue-500" size={24} />
    </div>
    <h3 className="text-xl font-bold mb-3">{title}</h3>
    <p className="text-slate-400 leading-relaxed">{desc}</p>
  </motion.div>
);

const App = () => {
  const { scrollYProgress } = useScroll();
  const opacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.2], [1, 0.95]);

  return (
    <div className="min-h-screen font-sans">
      <div className="scanline" />
      <Navbar />

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-6 hero-gradient overflow-hidden">
        <motion.div style={{ opacity, scale }} className="max-w-6xl mx-auto text-center">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-block px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold mb-8 uppercase tracking-widest"
          >
            v0.3.0 Now Available
          </motion.div>
          <h1 className="text-6xl md:text-8xl font-black mb-6 tracking-tighter text-gradient leading-tight">
            让 AI 操控你的<br />真实浏览器
          </h1>
          <p className="text-xl md:text-2xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            通过 MCP 协议，连接 Claude / Cursor / Codex 到你的 Chrome 浏览器，实现像真人一样的网页操作。
          </p>
          
          <div className="flex flex-wrap justify-center gap-4 mb-16">
            <button className="px-8 py-4 bg-blue-600 rounded-xl font-bold hover:bg-blue-700 transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(59,130,246,0.4)]">
              立即开始 <ChevronRight size={20} />
            </button>
            <button className="px-8 py-4 glass rounded-xl font-bold hover:bg-slate-800 transition-all">
              查看文档
            </button>
          </div>

          <div className="max-w-4xl mx-auto glass rounded-3xl p-2 border-white/5 relative shadow-2xl">
             <div className="absolute -top-4 -left-4 w-24 h-24 bg-blue-500/20 blur-3xl rounded-full" />
             <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-purple-500/20 blur-3xl rounded-full" />
             
             <div className="bg-[#0f172a] rounded-[22px] overflow-hidden border border-white/5">
                <div className="flex items-center gap-2 px-4 py-3 bg-white/5 border-bottom border-white/5">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-500/50" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                    <div className="w-3 h-3 rounded-full bg-green-500/50" />
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono flex-1 text-center">AGENT_INTERACTION.LOG</div>
                </div>
                <div className="p-6 text-left font-mono text-sm md:text-base min-h-[220px]">
                  <span className="text-purple-400">Agent:</span>{' '}
                  <TypeAnimation
                    sequence={[
                      '帮助我登录 GitHub 并在我的 profile 中添加一个星星。',
                      1000,
                      '正在分析页面结构...',
                      1500,
                      'browser_click({ text: \"Sign in\" })',
                      1000,
                      '正在填写用户名和密码...',
                      800,
                      'browser_type({ query: \"username\", text: \"****\" })',
                      2000,
                      '操作成功！任务已闭环。',
                      3000,
                    ]}
                    wrapper="span"
                    speed={50}
                    repeat={Infinity}
                    className="text-slate-300"
                  />
                </div>
             </div>
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section id="features" className="py-32 px-6 bg-slate-950/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">核心优势</h2>
            <p className="text-slate-400">为开发者和 Agent 打造的顶级浏览器基础设施</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard 
              icon={Zap} 
              title="极速响应" 
              desc="内置 Debugger 连接池管理，毫秒级响应 CDP 指令，彻底消除传统框架的启动延迟。"
              delay={0.1}
            />
            <FeatureCard 
              icon={Eye} 
              title="多模态自愈" 
              desc="当 DOM 结构发生变化时，视觉引擎会自动通过文字坐标进行操作补偿，确保任务不中断。"
              delay={0.2}
            />
            <FeatureCard 
              icon={Cpu} 
              title="MCP 原生" 
              desc="严格遵循 Model Context Protocol，零配置接入 Claude Desktop、Cursor 及主流 IDE。"
              delay={0.3}
            />
            <FeatureCard 
              icon={ShieldCheck} 
              title="安全审计" 
              desc="敏感操作（如删除、支付）自动弹出确认，全程记录操作日志，确保 AI 操作可控。"
              delay={0.4}
            />
            <FeatureCard 
              icon={MousePointer2} 
              title="语义化交互" 
              desc="Agent 可以直接说“点击查询按钮”，系统会自动处理同义词匹配和复杂的 DOM 过滤。"
              delay={0.5}
            />
            <FeatureCard 
              icon={Terminal} 
              title="跨会话管理" 
              desc="支持会话状态的导出与恢复，Agent 可以在不同工具间共享变量，实现复杂长流程任务。"
              delay={0.6}
            />
          </div>
        </div>
      </section>

      {/* Architecture */}
      <section id="architecture" className="py-32 px-6 border-y border-white/5">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-16">系统架构</h2>
          <div className="flex flex-col md:flex-row items-center justify-between gap-12 relative">
             <div className="absolute top-1/2 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-blue-500/20 to-transparent -translate-y-1/2 hidden md:block" />
             
             {[
               { name: 'AI Client', desc: 'Claude / Cursor' },
               { name: 'MCP Server', desc: 'Node.js Runtime' },
               { name: 'Extension', desc: 'Chrome Plugin' }
             ].map((node, i) => (
               <div key={i} className="z-10 bg-slate-900 border border-white/10 p-8 rounded-2xl w-full md:w-64">
                 <div className="text-blue-500 font-bold mb-2">0{i+1}</div>
                 <div className="text-xl font-bold mb-2">{node.name}</div>
                 <div className="text-slate-500 text-sm">{node.desc}</div>
               </div>
             ))}
          </div>
        </div>
      </section>

      {/* Installation */}
      <section id="install" className="py-32 px-6">
        <div className="max-w-4xl mx-auto glass p-12 rounded-[40px] text-center border-blue-500/10">
          <h2 className="text-4xl font-bold mb-8 text-gradient">准备好连接了吗？</h2>
          <p className="text-slate-400 mb-10 max-w-lg mx-auto">
            仅需两行命令，即可在本地启动 Browser Bridge 服务并开始使用。
          </p>
          <div className="bg-black/40 p-6 rounded-2xl font-mono text-left inline-block w-full max-w-2xl border border-white/5 shadow-inner">
             <div className="flex justify-between items-center text-slate-600 text-xs mb-4 uppercase tracking-widest">
               <span>bash</span>
               <span>terminal</span>
             </div>
             <div className="text-blue-400 mb-2">$ pnpm install</div>
             <div className="text-emerald-400">$ pnpm dev:server</div>
          </div>
          <div className="mt-12 text-slate-500 text-sm">
            支持 Windows, macOS (Apple Silicon & Intel), Linux
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-20 px-6 border-top border-white/5 text-center text-slate-500">
        <div className="mb-8 font-bold text-white flex justify-center items-center gap-2">
          <Layers size={18} className="text-blue-500" />
          <span>Browser Bridge</span>
        </div>
        <p className="text-sm">© 2026 Open Source Project. Built with MCP.</p>
        <div className="mt-4 flex justify-center gap-6 grayscale opacity-50 hover:grayscale-0 hover:opacity-100 transition-all">
           <Chrome size={20} />
           <Github size={20} />
           <Zap size={20} />
        </div>
      </footer>
    </div>
  );
};

export default App;
