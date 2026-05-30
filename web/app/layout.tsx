import { JetBrains_Mono, IBM_Plex_Mono, Spline_Sans_Mono } from 'next/font/google'
import '../styles/globals.css'

const jb = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jb', weight: ['400','500','700'] })
const ibm = IBM_Plex_Mono({ subsets: ['latin'], variable: '--font-ibm', weight: ['400','500','600'] })
const spline = Spline_Sans_Mono({ subsets: ['latin'], variable: '--font-spline', weight: ['400','500','600'] })

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" data-palette="amber" data-density="regular"
          className={`${jb.variable} ${ibm.variable} ${spline.variable}`}>
      <body>{children}</body>
    </html>
  )
}
