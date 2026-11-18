import test from "node:test";
import assert from "node:assert/strict";
import {ScopedReadCache} from "../lib/scopedReadCache.ts";

test("shared reads coalesce inflight and fresh values, expire, retry failures",async()=>{
  let now=0,calls=0;const cache=new ScopedReadCache(60,()=>now);cache.scope("a");
  const load=async()=>++calls;
  const [a,b]=await Promise.all([cache.read("evidence",load),cache.read("evidence",load)]);
  assert.equal(a,b);assert.equal(calls,1);
  assert.equal(cache.peek("evidence"),1);
  now=59;assert.equal(await cache.read("evidence",load),1);
  now=60;assert.equal(await cache.read("evidence",load),2);
  await assert.rejects(cache.read("error",async()=>{throw Error("technical");}),/technical/);
  assert.equal(await cache.read("error",load),3);
  await cache.read("partial",load,()=>false);await cache.read("partial",load);
  assert.equal(calls,5);
});

test("invalidations and account changes reject obsolete inflight results",async()=>{
  const cache=new ScopedReadCache();cache.scope("a");
  let resolve!:(v:string)=>void;
  const pending=cache.read("evidence",()=>new Promise<string>(r=>{resolve=r;}));
  await Promise.resolve();cache.invalidate();resolve("old");
  await assert.rejects(pending,/read_superseded/);
  assert.equal(await cache.read("evidence",async()=>"new"),"new");
  cache.scope("b");assert.equal(await cache.read("evidence",async()=>"b"),"b");
  const queued=cache.read("queued",async()=>{throw Error("must_not_start");});cache.scope(null);
  await assert.rejects(queued,/read_superseded/);
  await assert.rejects(cache.read("evidence",async()=>"leak"),/read_access_denied/);
  assert.equal(cache.peek("evidence"),null);
});
