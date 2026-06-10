// src/pages/Register.tsx
import { useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { apiClient } from '../api/client'

export default function RegisterPage() {
  const navigate = useNavigate()
  const [errorMessage, setErrorMessage] = useState('')

  const register = useMutation({
    mutationFn: (data: { name: string; password: string; email?: string }) =>
      apiClient('/user/create', { method: 'POST', body: data }),
    onSuccess: () => {
      navigate('/login')
    },
    onError: (error: Error) => {
      setErrorMessage(error.message)
    },
  })

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setErrorMessage('')

    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const password = formData.get('password') as string
    const email = formData.get('email') as string

    if (!name || !password) {
      setErrorMessage('please fill username and password')
      return
    }

    register.mutate({ name, password, email: email || undefined })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4"
        >
          <h1 className="text-xl font-semibold text-gray-900 text-center">
            Register
          </h1>

          {errorMessage && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{errorMessage}</span>
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Username <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              name="name"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password <span className="text-red-500">*</span>
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-gray-400 text-xs">(Optional)</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          <button
            type="submit"
            disabled={register.isPending}
            className="w-full py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {register.isPending ? 'registering...' : 'register'}
          </button>

          <p className="text-center text-sm text-gray-600">
            already have account?
            <Link to="/login" className="text-indigo-600 hover:text-indigo-800 ml-1">
              log in
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}