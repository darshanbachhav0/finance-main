import { useLayoutEffect, useRef } from "react";
export default function MotionCollapse({ open, children, ...props }) {
 const ref=useRef(null),first=useRef(true);
 useLayoutEffect(()=>{
  const node=ref.current;
  if(first.current || matchMedia("(prefers-reduced-motion: reduce)").matches){first.current=false;node.hidden=!open;return;}
  node.hidden=false;
  const height=node.scrollHeight;
  const overflow=node.style.overflow;node.style.overflow="hidden";
  const animation=node.animate(open?[{height:0,opacity:0},{height:`${height}px`,opacity:1}]:[{height:`${height}px`,opacity:1},{height:0,opacity:0}],{duration:180,easing:"ease-out"});
  animation.finished.then(()=>{node.hidden=!open;node.style.overflow=overflow;},()=>{});
  return()=>{animation.cancel();node.style.overflow=overflow;};
 },[open]);
 return <div {...props} ref={ref} hidden={!open} aria-hidden={!open} inert={!open?"":undefined}>{children}</div>;
}
