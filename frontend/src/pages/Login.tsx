import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Cloud, ArrowRight, Loader2 } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'

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
      if (isRegister) {
        await register(username, password, email || undefined)
      } else {
        await login(username, password, rememberMe)
      }
      navigate('/app')
    } catch {}
  }

  const switchMode = () => {
    setIsRegister(!isRegister)
    clearError()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F6F7] relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-[#1677FF]/[0.04] blur-[120px] pointer-events-none" />

      <motion.div
        className="relative w-full max-w-[380px] mx-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="text-center mb-8">
          <motion.div
            className="inline-flex items-center justify-center w-14 h-14 rounded-[14px] bg-gradient-to-br from-[#1677FF] to-[#69B1FF] shadow-lg shadow-blue-500/20 mb-4"
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <Cloud className="w-7 h-7 text-white" strokeWidth={1.8} />
          </motion.div>
          <h1 className="text-[26px] font-semibold text-[#1F2329] tracking-tight">
            {isRegister ? '创建你的 Cloud Nine' : '登录 Cloud Nine'}
          </h1>
          <p className="text-[14px] text-[#646A73] mt-1.5">
            {isRegister ? '注册账户，开始使用云存储' : '欢迎回来，登录你的云端'}
          </p>
        </div>

        <div className="bg-white rounded-lg p-6 shadow-[0_2px_20px_rgba(0,0,0,0.06)] border border-[#E5E6EB]">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-primary"
                placeholder="用户名"
                autoComplete="username"
                required
              />
            </div>

            <AnimatePresence mode="wait">
              {isRegister && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-primary"
                    placeholder="邮箱（可选）"
                    autoComplete="email"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-primary"
                placeholder={isRegister ? '密码（至少 8 位）' : '密码'}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                required
                minLength={isRegister ? 8 : undefined}
              />
            </div>

            {!isRegister && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#1677FF]"
                />
                <span className="text-[13px] text-[#646A73]">记住我</span>
              </label>
            )}

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-[#F53F3F] text-[13px] text-center"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 py-3 text-[15px] font-medium text-white bg-[#1677FF] hover:bg-[#4096FF] rounded-md transition-all active:scale-[0.98] disabled:opacity-50"
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  {isRegister ? '创建账户' : '登录'}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={switchMode}
            className="text-[13px] text-[#646A73] hover:text-[#1677FF] transition-colors"
          >
            {isRegister ? '已有账户？' : '没有账户？'}
            <span className="text-[#1677FF] font-medium ml-1">
              {isRegister ? '去登录' : '注册'}
            </span>
          </button>
        </div>

        <p className="text-center text-[11px] text-[#BCC0C6] mt-8">
          由 Cloud Nine 提供支持
        </p>
      </motion.div>
    </div>
  )
}
