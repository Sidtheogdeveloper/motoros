import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'MotorOS — Workshop Operations',
  description: 'The operating system for your workshop. Local development edition.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
