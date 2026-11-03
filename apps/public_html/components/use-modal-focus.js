'use client';
import { useLayoutEffect } from 'react';
export function useModalFocus(open) {
 useLayoutEffect(()=>{
  if(!open)return;
  const trigger=document.activeElement;
  const dialog=document.querySelector('.clone-preview');
  if(!dialog)return;
  const trap=event=>{
   if(event.key!=='Tab')return;
   const items=[...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
   const first=items[0],last=items.at(-1);
   if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first?.focus();}
  };
  document.addEventListener('keydown',trap);
  return ()=>{document.removeEventListener('keydown',trap);if(trigger?.isConnected)trigger.focus();};
 },[open]);
}
