import CreditBoard from './CreditBoard'

// CreditBoard.jsx는 원래 Claude 아티팩트 샌드박스의 window.storage(key-value)를 전제로 짜였다.
// 일반 브라우저엔 그 API가 없으니 localStorage로 폴리필해서 이 앱이 단독으로 동작하게 한다.
if (typeof window !== 'undefined' && !window.storage) {
  window.storage = {
    async get(key) {
      const value = window.localStorage.getItem(key)
      return value ? { value } : null
    },
    async set(key, value) {
      window.localStorage.setItem(key, value)
    },
  }
}

function App() {
  return <CreditBoard />
}

export default App
