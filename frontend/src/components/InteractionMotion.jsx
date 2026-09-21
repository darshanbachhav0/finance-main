import { useEffect } from "react";

export default function InteractionMotion() {
  useEffect(() => {
    const media=matchMedia("(prefers-reduced-motion: reduce)");
    const animations=new Set(), detailsRunning=new WeakMap();
    let frame;
    function animate(element,frames,options={}) {
      if(media.matches || document.documentElement.dataset.reduceMotion === "true" || !element?.isConnected)return;
      const animation=element.animate(frames,{duration:180,easing:"ease-out",...options});
      animations.add(animation);animation.finished.catch(()=>{}).finally(()=>animations.delete(animation));
      return animation;
    }
    function updateControls() {
      for(const button of document.querySelectorAll("button")) {
        const busy=button.disabled && /saving|submitting|processing|uploading|guardando|enviando|procesando|subiendo/i.test(button.textContent);
        if(busy && !button.classList.contains("motion-busy")){button.classList.add("motion-busy");button.setAttribute("aria-busy","true");}
        else if(!busy && button.classList.contains("motion-busy")){button.classList.remove("motion-busy");button.removeAttribute("aria-busy");}
      }
      for(const tabs of document.querySelectorAll(".analytics-tabs,.section-tabs")) {
        const selected=tabs.querySelector(".active,[aria-selected=true],[aria-current=page]");
        if(!selected)continue;
        const rect=selected.getBoundingClientRect(),outer=tabs.getBoundingClientRect();
        tabs.style.setProperty("--tab-left",`${rect.left-outer.left}px`);
        tabs.style.setProperty("--tab-top",`${rect.bottom-outer.top-2}px`);
        tabs.style.setProperty("--tab-width",`${rect.width}px`);
      }
    }
    const observer=new MutationObserver(records=>{
      for(const record of records){
        if(record.type==="characterData"){
          const changed=record.target.parentElement?.closest(".remaining-budget-limit strong,.notification-dot");
          if(changed)animate(changed,[{backgroundColor:"var(--uma-soft)"},{backgroundColor:"transparent"}],{duration:220});
        }
        for(const node of record.addedNodes){
          if(!(node instanceof Element))continue;
          for(const item of [node,...node.querySelectorAll(".notification-item,.notification-dot,.remaining-budget-source")]) {
            if(item.matches(".notification-item,.notification-dot"))animate(item,[{opacity:.3,transform:"translateY(-3px)"},{opacity:1,transform:"none"}]);
            if(item.matches(".remaining-budget-source"))animate(item,[{backgroundColor:"var(--uma-soft)"},{backgroundColor:"transparent"}],{duration:220});
          }
        }
        if(record.type==="attributes" && record.target.matches(".analytics-tabs button,.section-tabs a") && record.target.matches(".active,[aria-selected=true],[aria-current=page]")) {
          const panel=record.target.closest("section")?.querySelector("[role=tabpanel],.analytics-grid,.data-table");
          if(panel)animate(panel,[{opacity:.5},{opacity:1}]);
        }
      }
      cancelAnimationFrame(frame);frame=requestAnimationFrame(updateControls);
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["disabled","class","aria-selected","aria-current"]});
    function expand(event) {
      const summary=event.target.closest("summary");
      if(!summary || summary.parentElement.tagName!=="DETAILS" || media.matches || document.documentElement.dataset.reduceMotion === "true" || event.defaultPrevented)return;
      if(event.target.closest("button,a,input,select"))return;
      const details=summary.parentElement;
      event.preventDefault();
      const previous=detailsRunning.get(details);
      const opening=previous ? !previous.opening : !details.open;
      const start=details.getBoundingClientRect().height;
      previous?.animation?.cancel();
      details.open=true;
      const end=opening?details.getBoundingClientRect().height:summary.getBoundingClientRect().height+parseFloat(getComputedStyle(details).paddingTop)+parseFloat(getComputedStyle(details).paddingBottom);
      const oldOverflow=previous?.oldOverflow ?? details.style.overflow;
      details.style.overflow="hidden";
      const animation=animate(details,[{height:`${start}px`},{height:`${end}px`}]);
      const state={opening,animation,oldOverflow};detailsRunning.set(details,state);
      function finish(){if(detailsRunning.get(details)!==state)return;details.open=opening;details.style.overflow=oldOverflow;detailsRunning.delete(details);}
      animation?.finished.then(finish,finish);
    }
    function reduce(){if(media.matches || document.documentElement.dataset.reduceMotion === "true")for(const animation of document.getAnimations()) {try{animation.finish();}catch{animation.cancel();}}}
    document.addEventListener("click",expand);
    window.addEventListener("resize",updateControls);
    media.addEventListener("change",reduce);window.addEventListener("uma:accessibility",reduce);updateControls();
    return()=>{observer.disconnect();cancelAnimationFrame(frame);document.removeEventListener("click",expand);window.removeEventListener("resize",updateControls);media.removeEventListener("change",reduce);window.removeEventListener("uma:accessibility",reduce);for(const animation of animations)animation.cancel();};
  },[]);
  return null;
}
