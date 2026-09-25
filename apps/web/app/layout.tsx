import "./globals.css";
import Header from "./components/Header";

export const metadata = {
  title: "Nanas' Kitchens",
  description: "Real Food. Made by Neighbors.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        <div id="main-content" tabIndex={-1}>{children}</div>
      </body>
    </html>
  );
}
