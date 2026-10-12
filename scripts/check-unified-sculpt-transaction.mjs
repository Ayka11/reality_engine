import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const source=await readFile(new URL("../src/sculpt/UnifiedSculptTransactionCoordinator.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {UnifiedSculptTransactionCoordinator}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
function harness(){
 const legacy={value:0,history:[],redo:[]},field={value:0,history:[],redo:[],failUndo:false,failRedo:false,throwAfterCommit:false};
 const port={
  authoritativeCheckpoint:()=>String(field.value),
  undoLegacy(){const r=legacy.history.pop();if(!r)return null;legacy.value=r.before;legacy.redo.push(r);return r;},
  redoLegacy(){const r=legacy.redo.pop();if(!r)return null;legacy.value=r.after;legacy.history.push(r);return r;},
  undoAuthoritative(){if(field.failUndo)return null;const r=field.history.pop();if(!r)return null;field.value=r.before;field.redo.push(r);return r;},
  redoAuthoritative(){if(field.failRedo)return null;const r=field.redo.pop();if(!r)return null;field.value=r.after;field.history.push(r);return r;}
 };
 const tx=new UnifiedSculptTransactionCoordinator(port);
 const commit=(label,delta,fail=false)=>tx.commit(label,()=>{const r={before:legacy.value,after:legacy.value+delta};legacy.value=r.after;legacy.history.push(r);legacy.redo=[];return r;},()=>{
  if(fail)return null;const r={before:field.value,after:field.value+delta};field.value=r.after;field.history.push(r);field.redo=[];
  if(field.throwAfterCommit)throw new Error("persist failed after authoritative commit");return r;
 });
 return {legacy,field,tx,commit};
}
const h=harness();await h.commit("smart:Forest",10);await h.commit("brush:inject",3);assert.deepEqual([h.legacy.value,h.field.value],[13,13]);
assert.equal(h.tx.undo(),"brush:inject");assert.deepEqual([h.legacy.value,h.field.value],[10,10]);assert.equal(h.tx.undo(),"smart:Forest");assert.deepEqual([h.legacy.value,h.field.value],[0,0]);
assert.equal(h.tx.redo(),"smart:Forest");assert.deepEqual([h.legacy.value,h.field.value],[10,10]);assert.equal(h.tx.redo(),"brush:inject");assert.deepEqual([h.legacy.value,h.field.value],[13,13]);
const failed=harness();await assert.rejects(failed.commit("brush:fail",5,true),/rejected commit/);assert.deepEqual([failed.legacy.value,failed.field.value],[0,0]);assert.equal(failed.tx.getState().undo,0);
const partial=harness();partial.field.throwAfterCommit=true;await assert.rejects(partial.commit("smart:partial",8),/persist failed/);assert.deepEqual([partial.legacy.value,partial.field.value],[0,0]);assert.equal(partial.tx.getState().undo,0);
const failedUndo=harness();await failedUndo.commit("smart:Ocean",7);failedUndo.field.failUndo=true;assert.throws(()=>failedUndo.tx.undo(),/rejected undo/);assert.deepEqual([failedUndo.legacy.value,failedUndo.field.value],[7,7]);assert.equal(failedUndo.tx.getState().undo,1);
const failedRedo=harness();await failedRedo.commit("brush:erase",4);failedRedo.tx.undo();failedRedo.field.failRedo=true;assert.throws(()=>failedRedo.tx.redo(),/rejected redo/);assert.deepEqual([failedRedo.legacy.value,failedRedo.field.value],[0,0]);assert.equal(failedRedo.tx.getState().redo,1);
console.log("PASS: unified mixed SmartBrush/legacy transaction history");
console.log("PASS: commit/undo/redo failure rollback preserves both models");
