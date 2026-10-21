"use client";
import Link from 'next/link';
export default function ErrorPage({ reset }) {
  return (
    <main id="main-content" className="section">
      <h1>Something went wrong.</h1>
      <p>Please try loading this page again.</p>
      <button className="button" onClick={reset}>
        Try again
      </button>
      <Link href="/">Back to home</Link>
    </main>
  );
}
