'use client';

import dynamic from 'next/dynamic';

const PDFViewer = dynamic(() => import('./PDFViewer'), {
  ssr: false,
});

import { ErrorBoundary } from './components/ErrorBoundary';

export default function Page() {
  return (
    <ErrorBoundary>
      <PDFViewer />
    </ErrorBoundary>
  );
}