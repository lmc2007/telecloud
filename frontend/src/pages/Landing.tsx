import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useScroll, useTransform, AnimatePresence, useInView } from 'framer-motion'
import { Cloud, Shield, Zap, Share2, HardDrive, ArrowRight, Globe, Layers, ArrowUpRight } from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'

function AmbientBg() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <div className="absolute top-[-30%] left-1/2 -translate-x-1/2 w-[140%] h-[70%] rounded-full opacity-20"
        style={{ background: 'radial-gradient(ellipse, var(--accent) 0%, transparent 70%)', filter: 'blur(80px)' }} />
      <div className="absolute bottom-[-20%] left-[-10%] w-[60%] h-[50%] rounded-full opacity-10"
        style={{ background: 'radial-gradient(ellipse, #5AC8FA 0%, transparent 70%)', filter: 'blur(60px)' }} />
    </div>
  )
}

function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-100px' })
  return (
    <motion.div ref={ref} className={className}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}
    >{children}</motion.div>
  )
}

function TiltCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [r, setR] = useState({ x: 0, y: 0 })
  const [h, setH] = useState(false)
  return (
    <div ref={ref} className={`relative ${className}`}
      onMouseMove={e => {
        const el = ref.current; if (!el) return
        const rect = el.getBoundingClientRect()
        setR({ x: ((e.clientY - rect.top) / rect.height - 0.5) * -6, y: ((e.clientX - rect.left) / rect.width - 0.5) * 6 })
        setH(true)
      }}
      onMouseLeave={() => { setR({ x: 0, y: 0 }); setH(false) }}
      style={{ transform: `perspective(1000px) rotateX(${r.x}deg) rotateY(${r.y}deg) ${h ? 'scale(1.02)' : ''}`, transition: 'transform 0.15s ease-out', transformStyle: 'preserve-3d' }}
    >{children}</div>
  )
}

const features = [
  { icon: HardDrive, title: '无限空间', desc: '分布式云端架构，数据永不丢失。', color: 'var(--accent)' },
  { icon: Zap, title: '极速传输', desc: '流式引擎与全球加速，大文件秒传。', color: 'var(--orange)' },
  { icon: Shield, title: '端到端安全', desc: '加密传输与认证，只有你能访问。', color: 'var(--green)' },
  { icon: Share2, title: '智能分享', desc: '密码、有效期、下载次数，全权掌控。', color: 'var(--purple)' },
  { icon: Layers, title: '批量管理', desc: '多选、打包下载、一键移动。', color: 'var(--red)' },
  { icon: Globe, title: '随处访问', desc: 'PC、手机、平板，一个浏览器即可。', color: 'var(--accent)' },
]

export function Landing() {
  const navigate = useNavigate()
  const [splashDone, setSplashDone] = useState(false)
  const heroRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] })
  const heroOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0])
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 60])
  useEffect(() => { const t = setTimeout(() => setSplashDone(true), 1800); return () => clearTimeout(t) }, [])

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)', letterSpacing: '-0.02em' }}>
      <AmbientBg />

      <AnimatePresence>
        {!splashDone && (
          <motion.div className="fixed inset-0 z-[200] flex items-center justify-center"
            style={{ background: 'var(--bg)' }}
            exit={{ opacity: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
            <motion.div className="flex flex-col items-center gap-6"
              initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
              <motion.div className="relative w-[88px] h-[88px] rounded-[22px] flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, var(--accent), #5AC8FA)', boxShadow: 'var(--shadow-lg)' }}
                animate={{ scale: [1, 1.02, 1] }} transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}>
                <Cloud className="w-10 h-10 text-white" strokeWidth={1.4} />
                <motion.div className="absolute -inset-2 rounded-[28px] border" style={{ borderColor: 'var(--border-strong)' }}
                  animate={{ scale: [1, 1.08, 1], opacity: [0.8, 0, 0.8] }}
                  transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }} />
              </motion.div>
              <motion.span className="text-[26px] font-semibold tracking-tight"
                style={{ color: 'var(--text)' }}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.6 }}>Cloud Nine</motion.span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Nav */}
      <motion.nav className="fixed top-0 inset-x-0 z-50 h-14 flex items-center justify-between px-6"
        style={{ background: 'var(--bg-glass)', backdropFilter: 'blur(24px) saturate(180%)', borderBottom: '0.5px solid var(--border)' }}
        initial={{ y: -56, opacity: 0 }} animate={splashDone ? { y: 0, opacity: 1 } : {}}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-[8px] flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, var(--accent), #5AC8FA)', boxShadow: 'var(--shadow-sm)' }}>
            <Cloud className="w-4 h-4 text-white" strokeWidth={2} />
          </div>
          <span className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Cloud Nine</span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button onClick={() => navigate('/login')} className="text-[14px] transition-colors" style={{ color: 'var(--text-secondary)' }}>
            登录
          </button>
          <button onClick={() => navigate('/login')}
            className="text-[14px] font-medium text-white px-5 py-[7px] rounded-full transition-all duration-200 active:scale-[0.98]"
            style={{ background: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }}>
            免费开始
          </button>
        </div>
      </motion.nav>

      {/* Hero */}
      <section ref={heroRef} className="relative min-h-[100vh] flex flex-col items-center justify-center px-6 pt-24 pb-16">
        <motion.div style={{ opacity: heroOpacity, y: heroY }} className="text-center max-w-4xl">
          <motion.p className="text-[14px] font-medium mb-5 tracking-wide" style={{ color: 'var(--accent-text)' }}
            initial={{ opacity: 0, y: 12 }} animate={splashDone ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.2 }}>Cloud Nine</motion.p>
          <motion.h1 className="text-[52px] sm:text-[80px] font-semibold tracking-[-0.03em] leading-[1.04]" style={{ color: 'var(--text)' }}
            initial={{ opacity: 0, y: 40 }} animate={splashDone ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}>
            你的文件，<br />
            <span className="bg-clip-text text-transparent"
              style={{ backgroundImage: 'linear-gradient(90deg, var(--accent), #5AC8FA, var(--accent))', backgroundSize: '200% auto', animation: 'gradientShift 4s linear infinite' }}>
              随时随地在身边。
            </span>
          </motion.h1>
          <motion.p className="mt-7 text-[19px] sm:text-[22px] font-normal max-w-xl mx-auto leading-relaxed" style={{ color: 'var(--text-secondary)' }}
            initial={{ opacity: 0, y: 24 }} animate={splashDone ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, delay: 0.35 }}>
            无限容量 · 零成本 · 极速体验
          </motion.p>
          <motion.div className="mt-10"
            initial={{ opacity: 0, y: 16 }} animate={splashDone ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7, delay: 0.5 }}>
            <button onClick={() => navigate('/login')}
              className="group inline-flex items-center gap-2 text-[16px] font-medium text-white px-8 py-3.5 rounded-full transition-all duration-200 active:scale-[0.97]"
              style={{ background: 'var(--accent)', boxShadow: 'var(--shadow)' }}>
              立即体验 <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </motion.div>
        </motion.div>

        <motion.div className="absolute bottom-8 flex flex-col items-center gap-1"
          animate={splashDone ? { opacity: [0.4, 1, 0.4] } : { opacity: 0 }}
          transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}>
          <span className="text-[11px] tracking-widest uppercase" style={{ color: 'var(--text-tertiary)' }}>Scroll</span>
          <motion.div className="w-[1px] h-8 bg-gradient-to-b from-[var(--text-tertiary)] to-transparent" />
        </motion.div>
      </section>

      {/* Features */}
      <section className="py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <p className="text-[13px] font-medium tracking-widest uppercase mb-3" style={{ color: 'var(--accent-text)' }}>为什么选择 Cloud Nine</p>
            <h2 className="text-[40px] sm:text-[52px] font-semibold tracking-[-0.03em] leading-tight mb-4" style={{ color: 'var(--text)' }}>
              一切，只为简单。
            </h2>
            <p className="text-[18px] max-w-lg leading-relaxed mb-16" style={{ color: 'var(--text-secondary)' }}>从上传到分享，没有多余的一步。云存储本该如此。</p>
          </Reveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f, i) => (
              <Reveal key={f.title} delay={i * 0.07}>
                <TiltCard>
                  <div className="p-8 rounded-[20px] transition-all duration-300"
                    style={{ background: 'var(--bg-elev)', boxShadow: 'var(--shadow-sm)', border: '0.5px solid var(--border)' }}>
                    <div className="w-12 h-12 rounded-[14px] flex items-center justify-center mb-5"
                      style={{ background: 'var(--accent-light)' }}>
                      <f.icon className="w-[22px] h-[22px]" style={{ color: f.color }} strokeWidth={1.5} />
                    </div>
                    <h3 className="text-[18px] font-semibold mb-2" style={{ color: 'var(--text)' }}>{f.title}</h3>
                    <p className="text-[15px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{f.desc}</p>
                  </div>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Team */}
      <section className="py-28 px-6" style={{ background: 'var(--bg-elev)' }}>
        <div className="max-w-3xl mx-auto text-center">
          <Reveal>
            <p className="text-[13px] font-medium tracking-widest uppercase mb-4" style={{ color: 'var(--accent-text)' }}>LT 团队</p>
            <h2 className="text-[36px] sm:text-[44px] font-semibold tracking-[-0.02em] leading-tight mb-6" style={{ color: 'var(--text)' }}>
              一群热爱技术的人
            </h2>
            <p className="text-[18px] max-w-md mx-auto leading-relaxed mb-12" style={{ color: 'var(--text-secondary)' }}>
              致力于打造最纯粹的云存储体验。不做广告、不做追踪、不做恶心用户的事。
            </p>
            <div className="grid grid-cols-3 gap-6">
              {[
                { v: '∞', l: '存储空间' },
                { v: '¥0', l: '使用费用' },
                { v: '24/7', l: '持续在线' },
              ].map((s, i) => (
                <div key={i}>
                  <p className="text-[48px] sm:text-[56px] font-semibold tracking-[-0.02em] leading-none" style={{ color: 'var(--text)' }}>{s.v}</p>
                  <p className="mt-3 text-[14px]" style={{ color: 'var(--text-secondary)' }}>{s.l}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 px-6 text-center">
        <Reveal>
          <h2 className="text-[36px] sm:text-[48px] font-semibold tracking-[-0.03em] mb-4" style={{ color: 'var(--text)' }}>
            准备好开始了吗？
          </h2>
          <p className="text-[18px] mb-10" style={{ color: 'var(--text-secondary)' }}>无需注册费用，30 秒即可开始。</p>
          <button onClick={() => navigate('/login')}
            className="group inline-flex items-center gap-2 text-[16px] font-medium text-white px-9 py-3.5 rounded-full transition-all duration-200 active:scale-[0.97]"
            style={{ background: 'var(--accent)', boxShadow: 'var(--shadow)' }}>
            立即开始 <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </Reveal>
      </section>

      <footer className="py-6 px-6 text-center" style={{ borderTop: '0.5px solid var(--border)' }}>
        <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>Cloud Nine · 由 LT 团队开发维护</p>
      </footer>

      <style>{`
        @keyframes gradientShift {
          0%, 100% { background-position: 0% center; }
          50% { background-position: 200% center; }
        }
      `}</style>
    </div>
  )
}
