import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion'
import { Cloud, Shield, Zap, Share2, HardDrive, ArrowRight, ChevronDown } from 'lucide-react'

function FadeInSection({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.9', 'start 0.5'],
  })
  const opacity = useTransform(scrollYProgress, [0, 1], [0, 1])
  const y = useTransform(scrollYProgress, [0, 1], [40, 0])

  return (
    <motion.div ref={ref} style={{ opacity, y }} transition={{ delay, duration: 0.7 }}>
      {children}
    </motion.div>
  )
}

const features = [
  { icon: HardDrive, title: '无限空间', desc: '基于 Telegram 的无限云存储，你的文件永远有地方存放。', accent: '#1677FF' },
  { icon: Zap, title: '极速传输', desc: 'WebSocket 流式上传下载，全球 CDN 加速。', accent: '#FF8F1F' },
  { icon: Shield, title: '安全可靠', desc: '端到端加密传输，JWT 认证，数据安全无忧。', accent: '#00B578' },
  { icon: Share2, title: '轻松分享', desc: '一键生成链接，支持提取码和有效期设置。', accent: '#7C5CFC' },
]

export function Landing() {
  const navigate = useNavigate()
  const heroRef = useRef(null)
  const [splashDone, setSplashDone] = useState(false)
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  })
  const heroOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0])
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 120])

  useEffect(() => {
    const timer = setTimeout(() => setSplashDone(true), 2200)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      <AnimatePresence>
        {!splashDone && (
          <motion.div
            className="fixed inset-0 z-[200] bg-white flex items-center justify-center"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.div className="flex flex-col items-center gap-4">
              <motion.div
                className="w-20 h-20 rounded-[18px] bg-gradient-to-br from-[#1677FF] to-[#69B1FF] flex items-center justify-center shadow-lg shadow-blue-500/20"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              >
                <Cloud className="w-10 h-10 text-white" strokeWidth={1.8} />
              </motion.div>

              <motion.span
                className="text-[22px] font-semibold text-[#1F2329] tracking-tight"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.6 }}
              >
                Cloud Nine
              </motion.span>

              <motion.div
                className="w-12 h-[2px] bg-gray-100 rounded-full overflow-hidden mt-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
              >
                <motion.div
                  className="h-full bg-[#1677FF] rounded-full"
                  initial={{ width: '0%' }}
                  animate={{ width: '100%' }}
                  transition={{ delay: 0.9, duration: 1.2, ease: 'easeInOut' }}
                />
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.nav
        className="fixed top-0 left-0 right-0 z-50 h-12 flex items-center justify-between px-6 bg-white/80 backdrop-blur-xl"
        style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}
        initial={{ y: -48, opacity: 0 }}
        animate={splashDone ? { y: 0, opacity: 1 } : {}}
        transition={{ duration: 0.5 }}
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[#1677FF] to-[#69B1FF] flex items-center justify-center shadow-sm">
            <Cloud className="w-3.5 h-3.5 text-white" strokeWidth={2.2} />
          </div>
          <span className="text-[14px] font-semibold text-[#1F2329]">Cloud Nine</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/login')}
            className="text-[12px] text-[#646A73] hover:text-[#1F2329] transition-colors"
          >
            登录
          </button>
          <button
            onClick={() => navigate('/login')}
            className="text-[12px] font-medium text-white bg-[#1677FF] hover:bg-[#4096FF] px-4 py-1.5 rounded-md transition-colors"
          >
            免费开始
          </button>
        </div>
      </motion.nav>

      <section ref={heroRef} className="relative min-h-screen flex items-center justify-center bg-[#F5F6F7]">
        <motion.div style={{ opacity: heroOpacity, y: heroY }} className="text-center px-6 max-w-3xl mx-auto">
          <motion.h1
            className="text-5xl sm:text-7xl font-bold text-[#1F2329] tracking-tight leading-[1.08]"
            initial={{ opacity: 0, y: 30 }}
            animate={splashDone ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            你的云端
            <br />
            <span className="bg-gradient-to-r from-[#1677FF] via-[#4096FF] to-[#7C5CFC] bg-clip-text text-transparent">
              无限可能
            </span>
          </motion.h1>

          <motion.p
            className="mt-5 text-lg sm:text-xl text-[#646A73] font-light max-w-xl mx-auto leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={splashDone ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, delay: 0.15 }}
          >
            免费、安全、无容量限制的云存储。
            <br className="hidden sm:block" />
            上传你的文件，随时随地访问。
          </motion.p>

          <motion.div
            className="mt-8"
            initial={{ opacity: 0, y: 20 }}
            animate={splashDone ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, delay: 0.3 }}
          >
            <button
              onClick={() => navigate('/login')}
              className="inline-flex items-center gap-2 text-[15px] font-medium text-white bg-[#1677FF] hover:bg-[#4096FF] px-7 py-2.5 rounded-md transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] shadow-sm"
            >
              立即使用
              <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        </motion.div>

        <motion.div
          className="absolute bottom-10 left-1/2 -translate-x-1/2"
          animate={splashDone ? { y: [0, 6, 0] } : {}}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
        >
          <ChevronDown className="w-5 h-5 text-[#DCDEE0]" />
        </motion.div>
      </section>

      <section className="py-24 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <FadeInSection>
            <div className="text-center mb-16">
              <h2 className="text-4xl sm:text-5xl font-bold text-[#1F2329] tracking-tight">
                为什么选择 Cloud Nine
              </h2>
              <p className="mt-3 text-base text-[#646A73] font-light">
                简单、快速、安全。云存储本该如此。
              </p>
            </div>
          </FadeInSection>

          <div className="grid sm:grid-cols-2 gap-4">
            {features.map((feat, i) => (
              <FadeInSection key={feat.title} delay={i * 0.08}>
                <div className="group p-8 rounded-lg bg-[#FAFBFC] border border-[#E5E6EB] hover:border-[#1677FF]/30 hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)] transition-all duration-300">
                  <div
                    className="w-11 h-11 rounded-lg flex items-center justify-center mb-4"
                    style={{ background: `${feat.accent}15` }}
                  >
                    <feat.icon className="w-5 h-5" style={{ color: feat.accent }} strokeWidth={1.8} />
                  </div>
                  <h3 className="text-lg font-semibold text-[#1F2329] mb-1.5">{feat.title}</h3>
                  <p className="text-[14px] text-[#646A73] leading-relaxed">{feat.desc}</p>
                </div>
              </FadeInSection>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-6 bg-[#1F2329]">
        <div className="max-w-4xl mx-auto text-center">
          <FadeInSection>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              完全免费，没有套路
            </h2>
            <p className="mt-3 text-base text-[#8F959E] font-light">
              没有容量限制，没有速度限制，没有隐藏收费。
            </p>
          </FadeInSection>

          <div className="grid grid-cols-3 gap-4 sm:gap-8 mt-12 sm:mt-16">
            {[
              { value: '∞', label: '存储空间' },
              { value: '¥0', label: '使用费用' },
              { value: '256-bit', label: '加密传输' },
            ].map((stat, i) => (
              <FadeInSection key={stat.label} delay={i * 0.1}>
                <div>
                  <p className="text-3xl sm:text-5xl font-bold bg-gradient-to-r from-[#1677FF] via-[#4096FF] to-[#7C5CFC] bg-clip-text text-transparent">
                    {stat.value}
                  </p>
                  <p className="mt-2 text-[11px] sm:text-[12px] text-[#8F959E]">{stat.label}</p>
                </div>
              </FadeInSection>
            ))}
          </div>
        </div>
      </section>

      <section className="py-32 px-6 text-center bg-white">
        <FadeInSection>
          <h2 className="text-4xl sm:text-5xl font-bold text-[#1F2329] tracking-tight">
            准备好了吗？
          </h2>
          <p className="mt-3 text-base text-[#646A73] font-light">
            30 秒注册，立即开始使用。
          </p>
          <button
            onClick={() => navigate('/login')}
            className="inline-flex items-center gap-2 text-[15px] font-medium text-white bg-[#1677FF] hover:bg-[#4096FF] px-8 py-3 rounded-md transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] shadow-sm mt-8"
          >
            免费开始使用
            <ArrowRight className="w-4 h-4" />
          </button>
        </FadeInSection>
      </section>

      <footer className="py-5 px-4 sm:px-6" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Cloud className="w-3.5 h-3.5 text-[#BCC0C6]" />
            <span className="text-[11px] text-[#BCC0C6]">Cloud Nine</span>
          </div>
          <p className="text-[11px] text-[#DCDEE0]">基于 Telegram 的无限云存储</p>
        </div>
      </footer>
    </div>
  )
}
