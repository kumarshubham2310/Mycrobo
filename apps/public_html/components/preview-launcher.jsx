'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
const Preview = dynamic(() => import('./recovered/clone-preview-focus-9afb78fa6f').then(module => module.ClonePreview), { ssr: false });
export function PreviewLauncher() {
  const [activated, setActivated] = useState(false);
  useEffect(() => {
    const open = () => setActivated(true);
    window.addEventListener('mycrobo:open-clone', open);
    return () => window.removeEventListener('mycrobo:open-clone', open);
  }, []);
  return activated ? <Preview initialOpen /> : null;
}
