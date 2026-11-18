"use client";
import {useEffect,useId,useRef,useState,type ReactNode} from "react";
import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import {Swiper,SwiperSlide} from "swiper/react";
import {A11y,Autoplay} from "swiper/modules";
import {CircleHelp,CircleCheck,Check,BriefcaseBusiness,UserCheck,Users,MessageCircle,ChartColumnIncreasing} from "lucide-react";
import {Icon} from "./ui/Icon";
import {Panel} from "./ui/Panel";
import {Button} from "./ui/Button";
import {useHomeCarousel} from "./useHomeCarousel";
import {selectedGoalId,type Goal,type GamificationModel} from "../lib/gamificationModel";

function WeeklyGoals({goals,carousel,selected,setSelected}:{goals:Goal[];carousel:ReturnType<typeof useHomeCarousel>;selected:Goal["id"];setSelected:(id:Goal["id"])=>void}) {
  const id=useId();
  const active=selectedGoalId(selected,goals),identity=goals.map(g=>g.id).join("|");
  useEffect(()=>{setSelected(active as Goal["id"]);},[active]);
  return <section className="panel gam-goals" aria-labelledby={id}
    onPointerEnter={e=>{if(e.pointerType==="mouse")carousel.hover(true);}} onPointerLeave={()=>carousel.hover(false)}
    onFocusCapture={()=>carousel.focus(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))carousel.focus(false);}}
    onKeyDown={e=>{if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();carousel.select((goals.findIndex(g=>g.id===active)+(e.key==="ArrowLeft"?-1:1)+goals.length)%goals.length);}}}>
    <div className="panel-header"><h2 id={id} className="panel-title"><Icon name="target"/>Metas de la semana</h2></div>
    <div role="region" aria-roledescription="carrusel" aria-label="Metas semanales">
      <Swiper key={identity} modules={[A11y,Autoplay]} slidesPerView={1} loop speed={carousel.reduced?0:280} initialSlide={goals.findIndex(g=>g.id===active)}
        simulateTouch grabCursor threshold={8} preventClicks preventClicksPropagation
        autoplay={{enabled:false,delay:7000,disableOnInteraction:true}}
        onSwiper={carousel.bind} onSlideChange={s=>setSelected(goals[s.realIndex]?.id??goals[0].id)}
        onSliderFirstMove={carousel.manual} onTransitionEnd={carousel.sync}
        a11y={{enabled:true,wrapperLiveRegion:false,slideLabelMessage:"Meta {{index}} de {{slidesLength}}"}}>
        {goals.map(goal=><SwiperSlide key={goal.id}><div className="gam-goal" aria-hidden={goal.id!==active} inert={goal.id!==active}>
          <div className="gam-goal-heading"><h3><Icon name={goal.id==="realized"?"coffee":goal.id==="projected"?"calendar":"tag"}/>{goal.title}</h3>
            {goal.completed?<span className="gam-complete"><CircleCheck aria-hidden="true"/>¡Meta cumplida!</span>:null}
          </div>
          <p>{goal.id==="projected"?"Para la próxima semana":goal.id==="realized"?"Esta semana":"de tus contactos ya contactados"}</p>
          <div className="gam-progress-row"><div className="gam-progress" role="progressbar" aria-label={goal.title} aria-valuemin={0} aria-valuemax={goal.target} aria-valuenow={goal.metric.value===null?undefined:Math.min(goal.target,goal.metric.value)} aria-valuetext={goalDisplayText(goal)}><span style={{width:`${goal.progress}%`}}/></div><strong>{goalDisplayText(goal)}</strong></div>
        </div></SwiperSlide>)}
      </Swiper>
    </div>
    <div className="gam-dots">{goals.map((g,i)=><button key={g.id} type="button" aria-label={`Ver meta: ${g.title}`} aria-current={g.id===active?"true":undefined} onClick={()=>carousel.select(i)}><span/></button>)}</div>
  </section>;
}

export function goalDisplayText(goal:Goal) {
  if(goal.metric.value!==null)return goal.text;
  if(goal.metric.reason==="read_failed")return "No pudimos actualizar esta meta";
  if(goal.metric.reason==="Sin contactos para evaluar")return goal.metric.reason;
  return goal.id==="projected"?"Revisa las fechas de tus próximas citas":"No pudimos actualizar esta meta";
}
function StreakIcon({temporal:t}:{temporal:GamificationModel["temporal"]}) {
  const [open,setOpen]=useState(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const trigger=useRef<HTMLButtonElement>(null),content=useRef<HTMLDivElement>(null);
  const level=t.initial?"empty":t.level;
  const levelLabel=level==="fire"?"Nivel 1":level==="rocket"?"Nivel 2":level==="radiation"?"Nivel nuclear!":level==="unknown"?"Error de lectura":"Sin cafés";
  const message=t.average===null?"No pudimos actualizar tus cafés. Reintenta la lectura.":`${new Intl.NumberFormat("es-CL",{minimumFractionDigits:1,maximumFractionDigits:1}).format(t.average)} cafés por semana · ${t.averageDays<28?`últimos ${new Intl.NumberFormat("es-CL",{maximumFractionDigits:1}).format(t.averageDays)} días disponibles`:"últimos 28 días"}`;
  function cancelClose(){if(timer.current)clearTimeout(timer.current);}
  function show(){cancelClose();setOpen(true);}
  function leave(){cancelClose();timer.current=setTimeout(()=>{if(!trigger.current?.matches(":focus-visible")&&!content.current?.contains(document.activeElement))setOpen(false);},140);}
  useEffect(()=>()=>cancelClose(),[]);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><button ref={trigger} type="button" className={`gam-level-trigger level-${level}`} aria-label="Consultar promedio semanal de cafés"
      onClick={e=>{e.preventDefault();show();}} onPointerEnter={e=>{if(e.pointerType==="mouse")show();}} onPointerLeave={leave} onFocus={e=>{if(e.currentTarget.matches(":focus-visible"))show();}}
      onBlur={e=>{if(!content.current?.contains(e.relatedTarget))setOpen(false);}}>
      {level==="unknown"?<CircleHelp className="gam-level" aria-hidden="true"/>:<img className="gam-level" src={`/gamification/${level}.svg`} width={64} height={64} alt=""/>}
      <span className="gam-level-label">{levelLabel}</span>
    </button></Popover.Trigger>
    <Popover.Portal><Popover.Content ref={content} className="gam-average-popover" side="top" align="center" sideOffset={8} collisionPadding={12} avoidCollisions
      aria-label="Promedio de cafés" onOpenAutoFocus={e=>e.preventDefault()} onCloseAutoFocus={e=>e.preventDefault()}
      onPointerEnter={cancelClose} onPointerLeave={leave} onFocusCapture={cancelClose} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget)&&e.relatedTarget!==trigger.current)setOpen(false);}}>
      {message}<Popover.Arrow className="gam-popover-arrow"/>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
const routeIcons=[BriefcaseBusiness,UserCheck,Users,MessageCircle,BriefcaseBusiness];
const statIcons=[null,Users,null,BriefcaseBusiness];
type Props={model:GamificationModel|null;loading?:boolean;error?:boolean;onRetry?:()=>void;children?:ReactNode};
export function GamificationPanel({model,loading=false,error=false,onRetry,children}:Props) {
  const id=useId();
  const carousel=useHomeCarousel(Boolean(model)&&!loading);
  const [selected,setSelected]=useState<Goal["id"]>("realized");
  if(!model&&loading)return <>
    <div className="gam-route-block" aria-busy="true">
      <section className="panel gam-route gam-loading-route" aria-label="Cargando avances">
        <span className="sr-only" role="status">Cargando Inicio</span>
        <div className="gam-loading-heading gam-placeholder" aria-hidden="true"/>
        <div className="gam-loading-summary gam-placeholder" aria-hidden="true"/>
      </section>
    </div>
    <div className="gamification" aria-busy="true">
      <section className="panel gam-goals" aria-label="Metas de la semana">
        <div className="panel-header"><h2 className="panel-title"><Icon name="target"/>Metas de la semana</h2></div>
        <div className="gam-loading-goal gam-placeholder" aria-hidden="true"/>
      </section>
      <section className="gam-streak" aria-label="Racha de networking">
        <span className="gam-loading-icon gam-placeholder" aria-hidden="true"/>
        <div><h2>Racha de networking</h2><div className="gam-loading-line gam-placeholder" aria-hidden="true"/></div>
        <span className="gam-loading-value gam-placeholder" aria-hidden="true"/>
      </section>
    </div>{children}
  </>;
  if(!model)return <>
    <div className="gam-route-block"><Panel title="Tu networking"><p role="status">No pudimos verificar tus avances.</p><Button onClick={onRetry}>Reintentar</Button></Panel></div>{children}
  </>;
  const t=model.temporal,complete=model.route?.every(m=>m.done);
  const doneCount=model.route?.filter(m=>m.done).length??0;
  return <>
    <div className="gam-route-block"><Panel title={!model.route?"Tu networking":complete?"Tu networking en cifras":"Ruta de inicio"} icon={complete?<ChartColumnIncreasing aria-hidden="true"/>:<Icon name="target"/>} className={`gam-route${model.route&&!complete?" has-route-count":""}`}>
      {!model.route?<p className="empty-value">No pudimos verificar todos los hitos. <Button onClick={onRetry}>Reintentar</Button></p>:complete?<div className="gam-statistics">{model.metrics.filter(stat=>stat.id!=="interviews").map((stat,i)=>{const StatIcon=statIcons[i];return <div className="gam-stat" key={stat.id}><span className="gam-stat-icon">{StatIcon?<StatIcon aria-hidden="true"/>:<Icon name={i===0?"tag":"coffee"}/>}</span><div><strong>{stat.metric.value??"—"}</strong><span>{stat.title}</span>{stat.metric.value===null?<small>No disponible</small>:null}</div></div>;})}</div>:<>
        <span className="gam-route-count">{doneCount} de 5 completados</span>
        <ol className="gam-tiles" aria-label="Ruta de inicio">{model.route.map((m,i)=>{const ItemIcon=routeIcons[i];const content=<>
          {m.done?<CircleCheck className="gam-tile-check" aria-hidden="true"/>:null}<ItemIcon className="gam-tile-icon" aria-hidden="true"/><strong>{m.title}</strong><span className="gam-tile-action">{m.done?<><Check aria-hidden="true"/>Listo</>:"Ir →"}</span>
        </>;return <li key={m.id}>{m.done?<div className="gam-tile is-done">{content}</div>:<Link href={m.href} className="gam-tile" aria-label={`${m.title}: Ir`}>{content}</Link>}</li>;})}</ol>
      </>}
    </Panel></div>
    <div className="gamification" aria-label="Networking personal" aria-busy={loading}>
      <WeeklyGoals goals={model.goals} carousel={carousel} selected={selected} setSelected={setSelected}/>
      <section className="gam-streak" aria-labelledby={id}>
        <StreakIcon temporal={t}/><div><h2 id={id}>Racha de networking</h2><p>{t.streak.value===null?"No pudimos actualizar tus cafés":t.initial?"Concreta tu primer café para empezar tu racha":`${t.streak.value} ${t.streak.value===1?"semana seguida":"semanas seguidas"} con al menos 1 café`}</p></div>
        <strong className="gam-streak-value" aria-label="Semanas de racha">{t.streak.value??"—"}</strong>
      </section>
      {error?<p role="alert" className="gam-error">Algunos datos no están disponibles. <Button onClick={onRetry}>Reintentar</Button></p>:null}
    </div>
    {children}
  </>;
}
