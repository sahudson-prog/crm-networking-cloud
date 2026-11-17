const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const path=require('node:path');

// Execute the actual component's handlers and effects, retaining hook state across renders.
function fixture(){
  const hooks=[],effects=[],listeners=new Map();let cursor=0,reduced=false;
  const document={hidden:false,addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener(){}};
  const media={get matches(){return reduced;},addEventListener:(key,fn)=>listeners.set('motion',fn),removeEventListener(){}};
  const react={
    useRef(value){const i=cursor++;return hooks[i]??(hooks[i]={current:value});},
    useState(value){const i=cursor++;if(!(i in hooks))hooks[i]=value;return [hooks[i],v=>{hooks[i]=v;}];},
    useEffect(fn,deps){const i=cursor++;if(!hooks[i]||deps.some((v,j)=>v!==hooks[i][j]))effects.push(fn);hooks[i]=deps;}
  };
  const jsx=(type,props)=>({type,props});
  const imports={react,'react/jsx-runtime':{jsx,jsxs:jsx},'swiper/react':{Swiper:'Swiper',SwiperSlide:'Slide'},'swiper/modules':{A11y:{},Autoplay:{},Keyboard:{}}};
  const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../components/ProductSlideshow.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports','window','document',code)(id=>{assert.ok(id in imports);return imports[id];},module,module.exports,{matchMedia:()=>media},document);
  const swiper={destroyed:false,animating:false,keyboard:{enable(){},disable(){}},autoplay:{running:false,paused:false,
    start(){this.running=true;},stop(){this.running=false;},pause(){this.paused=true;},resume(){if(this.running)this.paused=false;}}};
  let view;const slides=[0,1,2].map(id=>({id:String(id),src:'synthetic.svg',alt:'Synthetic'}));
  function render(){cursor=0;view=module.exports.ProductSlideshow({slides});while(effects.length)effects.shift()();return view;}
  render();render();view.props.children.props.onSwiper(swiper);
  return {swiper,document,render,get view(){return view;},get events(){return view.props.children.props;},motion(value){reduced=value;listeners.get('motion')();render();},visibility(value){document.hidden=value;listeners.get('visibilitychange')();}};
}
test('product completes transitions, clears stale paused state and re-arms every loop',()=>{
  const f=fixture();assert.equal(f.swiper.autoplay.running,true);
  for(let i=0;i<9;i++){
    f.swiper.animating=true;f.swiper.autoplay.paused=true;
    f.events.onSlideChange(f.swiper);
    assert.equal(f.swiper.autoplay.running,false);assert.equal(f.swiper.autoplay.paused,false);
    f.events.onAutoplayResume();assert.equal(f.swiper.autoplay.running,false);
    f.swiper.animating=false;f.events.onTransitionEnd();assert.equal(f.swiper.autoplay.running,true);
  }
  assert.equal(f.events.autoplay.delay,5000);assert.equal(f.events.loop,true);
});
test('hover, keyboard focus and touch pause independently; leaving one cannot override another',()=>{
  const f=fixture(),p=f.view.props;
  p.onPointerEnter({pointerType:'mouse'});assert.equal(f.swiper.autoplay.paused,true);
  p.onFocusCapture();p.onPointerLeave({pointerType:'mouse'});assert.equal(f.swiper.autoplay.paused,true);
  f.events.onTouchStart();p.onBlurCapture({currentTarget:{contains:()=>false},relatedTarget:null});assert.equal(f.swiper.autoplay.paused,true);
  f.events.onTouchEnd();assert.equal(f.swiper.autoplay.paused,false);
  assert.equal(f.events.allowTouchMove,true);assert.equal(f.events.keyboard.onlyInViewport,true);
});
test('hidden document and reduced motion stop autoplay and restore it safely',()=>{
  const f=fixture();f.visibility(true);assert.equal(f.swiper.autoplay.paused,true);
  f.motion(true);assert.equal(f.swiper.autoplay.running,false);assert.equal(f.swiper.autoplay.paused,false);
  f.visibility(false);assert.equal(f.swiper.autoplay.running,false);
  f.motion(false);assert.equal(f.swiper.autoplay.running,true);assert.equal(f.swiper.autoplay.paused,false);
});

test('loop initialization without a transitionEnd re-arms on the next microtask',async()=>{
  const f=fixture();
  f.swiper.animating=false;
  f.events.onSlideChange(f.swiper);
  assert.equal(f.swiper.autoplay.running,false);
  await Promise.resolve();
  assert.equal(f.swiper.autoplay.running,true);
});
