import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Cloud, ArrowRight, Loader2 } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { ThemeToggle } from '../components/ThemeToggle'

export function Login() {
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const { login, register, isLoading, error, clearError } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (isRegister) await register(username, password, email || undefined)
      else await login(username, password, rememberMe)
      navigate('/app')
    } catch {}
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: 'var(--bg)' }}>
      {/* Theme toggle top-right */}
      <div className="absolute top-5 right-5 z-10">
        <ThemeToggle />
      </div>

      <motion.div className="w-full max-w-[400px] mx-6"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}>
        <div className="text-center mb-10">
          <motion.div className="inline-flex items-center justify-center w-16 h-16 rounded-[20px] mb-5"
            style={{ background: 'linear-gradient(135deg, var(--accent), #5AC8FA)', boxShadow: 'var(--shadow-lg)' }}
            initial={{ scale: 0.85 }} animate={{ scale: 1 }}
            transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}>
            <Cloud className="w-7 h-7 text-white" strokeWidth={1.6} />
          </motion.div>
          <h1 className="text-[28px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
            {isRegister ? '创建账户' : '登录 Cloud Nine'}
          </h1>
          <p className="text-[15px] mt-1.5" style={{ color: 'var(--text-secondary)' }}>
            {isRegister ? '马上开始使用云存储' : '欢迎回来'}
          </p>
        </div>

        <div className="rounded-2xl p-8"
          style={{ background: 'var(--bg-glass)', backdropFilter: 'blur(24px)', boxShadow: 'var(--shadow)', border: '0.5px solid var(--border)' }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="input-primary" placeholder="用户名" autoComplete="username" required />
            <AnimatePresence mode="wait">
              {isRegister && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-primary" placeholder="邮箱（可选）" autoComplete="email" />
                </motion.div>
              )}
            </AnimatePresence>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input-primary" placeholder={isRegister ? '密码（至少8位）' : '密码'} autoComplete={isRegister ? 'new-password' : 'current-password'} required minLength={isRegister ? 8 : undefined} />
            {!isRegister && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} className="w-4 h-4 rounded accent-[var(--accent)]" />
                <span className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>记住我</span>
              </label>
            )}
            <AnimatePresence>{error && <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[13px] text-center" style={{ color: 'var(--red)' }}>{error}</motion.p>}</AnimatePresence>
            <button type="submit" disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 py-3 text-[15px] font-medium text-white rounded-full transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'var(--accent)' }}>
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>{isRegister ? '创建账户' : '登录'} <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
        </div>

        <div className="mt-6 text-center">
          <button onClick={() => { setIsRegister(!isRegister); clearError() }} className="text-[14px] transition-colors"
            style={{ color: 'var(--accent-text)' }}>
            {isRegister ? '已有账户？去登录' : '没有账户？注册'}
          </button>
        </div>
        <p className="text-center text-[12px] mt-8" style={{ color: 'var(--text-tertiary)' }}>Cloud Nine · LT 团队</p>
      </motion.div>
    </div>
  )
}
