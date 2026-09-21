import { useLayoutEffect, useRef } from "react";
export default function MotionList({ children, className }) {
  const ref = useRef(null), previous = useRef(new Map()), running = useRef(new Set());
  useLayoutEffect(() => {
    const node = ref.current;
    const reduced = (matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reduceMotion === "true");
    const next = new Map();
    const structuralChange = previous.current.size !== node.children.length || [...node.children].some(child => !previous.current.has(child.dataset.motionKey));
    for (const child of node.children) {
      const key = child.dataset.motionKey;
      const rect = child.getBoundingClientRect();
      const old = previous.current.get(key);
      if (!reduced && (!old || structuralChange && Math.abs(old.documentTop-(rect.top+window.scrollY))>1)) {
        const frames = old ? [{transform:`translateY(${old.documentTop-(rect.top+window.scrollY)}px)`},{transform:"none"}] : [{opacity:0,transform:"translateY(-6px)"},{opacity:1,transform:"none"}];
        const animation = child.animate(frames,{duration:180,easing:"ease-out"});
        running.current.add(animation);animation.finished.catch(()=>{}).finally(()=>running.current.delete(animation));
      }
      next.set(key,{rect,documentTop:rect.top+window.scrollY,clone:child.cloneNode(true)});
    }
    if (!reduced) for (const [key,old] of previous.current) {
      if (next.has(key)) continue;
      const ghost=old.clone;
      ghost.setAttribute("inert","");ghost.setAttribute("aria-hidden","true");
      for(const element of [ghost,...ghost.querySelectorAll("*")]) {element.removeAttribute("id");element.removeAttribute("name");element.removeAttribute("form");}
      Object.assign(ghost.style,{position:"fixed",top:`${old.documentTop-window.scrollY}px`,left:`${old.rect.left}px`,width:`${old.rect.width}px`,height:`${old.rect.height}px`,pointerEvents:"none",overflow:"hidden",zIndex:5});
      document.body.append(ghost);
      const animation=ghost.animate([{opacity:.7,clipPath:"inset(0 0 0 0)"},{opacity:0,clipPath:"inset(0 0 100% 0)"}],{duration:160,easing:"ease-out"});
      running.current.add(animation);animation.finished.catch(()=>{}).finally(()=>{ghost.remove();running.current.delete(animation);});
    }
    previous.current=next;
  });
  useLayoutEffect(()=>()=>{for(const animation of running.current)animation.cancel();previous.current.clear();},[]);
  return <div ref={ref} className={className}>{children}</div>;
}
