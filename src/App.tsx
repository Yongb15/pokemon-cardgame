import { Outlet, ScrollRestoration } from 'react-router'
import Footer from './components/Footer'
import Header from './components/Header'

/** Shared page frame for every route */
function App() {
  return (
    <>
      <Header />
      <Outlet />
      <Footer />
      <ScrollRestoration />
    </>
  )
}

export default App
