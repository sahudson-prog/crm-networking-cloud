"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Swiper, SwiperSlide } from "swiper/react";
import { A11y, Autoplay, Keyboard } from "swiper/modules";
import type { Swiper as SwiperInstance } from "swiper";
import { ArrowLeft, ArrowRight, Newspaper, X } from "lucide-react";
import { useBodyScrollLock } from "./useBodyScrollLock";
import { Panel } from "./ui/Panel";
export type EditorialContent = { status:string; slides:{id:string;srcdoc:string}[] };
let cached: {until:number; promise:Promise<EditorialContent>} | undefined;
function load():Promise<EditorialContent> {
  if(cached && cached.until>Date.now())return cached.promise;
  const promise=fetch('/api/editorial',{credentials:'omit'}).then(r=>{if(!r.ok)throw Error();return r.json();}).catch(()=>({status:'error',slides:[]}));
  cached={until:Date.now()+60000,promise};return promise;
}
// The compact presentation clips its own document; the expanded view keeps the original scrollable srcdoc.
const compactStyle = '<style>html,body,main{height:100%!important;max-height:100%!important;min-height:0!important;overflow:clip!important}</style>';
function compactDocument(srcdoc:string):string {
  return srcdoc.replace('</head>',`${compactStyle}</head>`);
}
export function EditorialFeed({fixture}: {fixture?:EditorialContent}) {
  const [data,setData]=useState<EditorialContent>(fixture??{status:'loading',slides:[]});
  const [preserveScrollbar,setPreserveScrollbar]=useState(false);
  const [index,setIndex]=useState(0),[open,setOpen]=useState(false),[reduced,setReduced]=useState(true);
  const swiper=useRef<SwiperInstance|null>(null),dialog=useRef<HTMLDialogElement>(null),more=useRef<HTMLButtonElement>(null);
  const interaction=useRef({hover:false,focus:false,touch:false}),policy=useRef({open,reduced,count:data.slides.length});
  policy.current={open,reduced,count:data.slides.length};
  const titleId=useId(),multiple=data.slides.length>1;
  const tracker=useRef<HTMLDivElement>(null),engine=useRef({reset:true,changing:false});
  useBodyScrollLock(open);
  function paintProgress(realIndex:number,progress:number) {
    tracker.current?.querySelectorAll<HTMLElement>('.editorial-segment-fill').forEach((fill,i)=>{
      fill.style.transform=`scaleX(${i<realIndex?1:i===realIndex?Math.max(0,Math.min(1,progress)):0})`;
    });
  }
  function stop(s:SwiperInstance) {
    // Swiper keeps its paused flag across stop/start. Clear it using its API.
    engine.current.changing=true;
    if(s.autoplay.running&&s.autoplay.paused)s.autoplay.resume();
    s.autoplay.stop();
    engine.current.changing=false;
  }
  function syncAutoplay(reset=false) {
    const s=swiper.current,p=policy.current;if(!s||s.destroyed||engine.current.changing)return;
    if(reset)engine.current.reset=true;
    if(p.count<2||p.reduced){stop(s);engine.current.reset=true;return;}
    const blocked=p.open||document.hidden||interaction.current.hover||interaction.current.focus||interaction.current.touch;
    if(blocked||s.animating){
      if(engine.current.reset){stop(s);paintProgress(s.realIndex,0);}
      else if(s.autoplay.running&&!s.autoplay.paused)s.autoplay.pause();
      return;
    }
    if(engine.current.reset||!s.autoplay.running){stop(s);engine.current.reset=false;s.autoplay.start();}
    else if(s.autoplay.paused)s.autoplay.resume();
  }
  useEffect(()=>{if(fixture){setData(fixture);return;}let active=true;void load().then(v=>{if(active)setData(v);});return()=>{active=false;};},[fixture]);
  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(media.matches);
    change();media.addEventListener('change',change);
    const visible=()=>syncAutoplay();document.addEventListener('visibilitychange',visible);
    return()=>{media.removeEventListener('change',change);document.removeEventListener('visibilitychange',visible);};
  },[]);
  useEffect(()=>{syncAutoplay(true);},[reduced,data.slides]);
  useEffect(()=>{syncAutoplay();},[open]);
  useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
  function advance(direction:'previous'|'next') {
    const s=swiper.current;if(!s||s.destroyed||!multiple)return;stop(s);engine.current.reset=true;
    if(direction==='next')s.slideNext();else s.slidePrev();
  }
  function expand() {setPreserveScrollbar(window.innerWidth>document.documentElement.clientWidth);setOpen(true);}
  function close() {engine.current.reset=true;dialog.current?.close();setOpen(false);more.current?.focus({preventScroll:true});}
  const active=data.slides[index]??data.slides[0];
  return <Panel title="Información y novedades" icon={<Newspaper aria-hidden="true"/>} className="functional-block editorial-block">
    {data.slides.length ? <div className="editorial-viewport" role="region" aria-roledescription="carrusel" aria-label="Novedades"
      onPointerEnter={e=>{if(e.pointerType==='mouse'){interaction.current.hover=true;syncAutoplay();}}}
      onPointerLeave={e=>{if(e.pointerType==='mouse'){interaction.current.hover=false;syncAutoplay();}}}
      onFocusCapture={e=>{if(e.target.matches(':focus-visible'))interaction.current.focus=true;swiper.current?.keyboard.enable();syncAutoplay();}}
      onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget)){interaction.current.focus=false;swiper.current?.keyboard.disable();syncAutoplay();}}}>
      <Swiper key={data.slides.map(s=>s.id).join('|')} className="editorial-swiper" modules={[A11y,Autoplay,Keyboard]} slidesPerView={1}
        speed={reduced?0:420} loop={multiple} allowTouchMove={multiple} simulateTouch grabCursor={multiple}
        keyboard={{enabled:false,onlyInViewport:true}}
        autoplay={{enabled:false,delay:7000,disableOnInteraction:false,pauseOnMouseEnter:true}}
        onSwiper={s=>{swiper.current=s;setIndex(s.realIndex);syncAutoplay();}}
        onSlideChange={s=>{setIndex(s.realIndex);engine.current.reset=true;stop(s);paintProgress(s.realIndex,0);}}
        onTransitionEnd={()=>syncAutoplay()} onAutoplayResume={()=>syncAutoplay()}
        onTouchStart={()=>{interaction.current.touch=true;syncAutoplay();}}
        onTouchEnd={()=>{interaction.current.touch=false;syncAutoplay();}}
        onAutoplayTimeLeft={(s,_ms,remaining)=>{if(!engine.current.reset&&!s.autoplay.paused)paintProgress(s.realIndex,1-remaining);}}
        a11y={{enabled:true,slideLabelMessage:'Diapositiva {{index}} de {{slidesLength}}'}}>
        {data.slides.map((s,i)=><SwiperSlide key={s.id}><iframe title={`Novedad ${i+1} de ${data.slides.length}`} srcDoc={compactDocument(s.srcdoc)} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" tabIndex={-1} inert/></SwiperSlide>)}
      </Swiper>
      {multiple?<><div ref={tracker} className="editorial-tracker" aria-hidden="true">{data.slides.map((slide,i)=><span key={slide.id} className="editorial-segment"><span className="editorial-segment-fill" style={{transform:`scaleX(${i<index?1:0})`}}/></span>)}</div>
        <span className="sr-only" aria-live={reduced?'polite':'off'}>Diapositiva {index+1} de {data.slides.length}</span>
        <button className="editorial-arrow previous" type="button" aria-label="Novedad anterior" onClick={()=>advance('previous')}><ArrowLeft/></button>
        <button className="editorial-arrow next" type="button" aria-label="Novedad siguiente" onClick={()=>advance('next')}><ArrowRight/></button></>:null}
      <button ref={more} className="editorial-more" type="button" onClick={expand}>Ver más</button>
    </div>:<p className="editorial-empty" role="status">{data.status==='loading'?'Cargando novedades…':data.status==='error'?'Las novedades no están disponibles en este momento.':'Sin novedades por ahora'}</p>}
    {open&&active?createPortal(<dialog ref={dialog} className="editorial-dialog" data-preserve-scrollbar={preserveScrollbar||undefined} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();close();}}>
      <div className="editorial-dialog-heading"><h2 id={titleId}>Novedad {index+1} de {data.slides.length}</h2><button type="button" className="button ghost square" aria-label="Cerrar novedad" autoFocus onClick={close}><X aria-hidden="true"/></button></div>
      <iframe title="Novedad ampliada" srcDoc={active.srcdoc} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"/>
    </dialog>,document.body):null}
  </Panel>;
}