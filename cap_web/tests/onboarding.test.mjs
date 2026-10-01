import test from 'node:test';
import assert from 'node:assert/strict';
import { profileFromForm } from '../src/data/profile.js';
import { renderOnboarding } from '../src/views/onboarding-view.js';
import { renderMobileOnboarding } from '../src/mobile/mobile-app.js';

test('basic profile save makes all features available without changing output preferences', () => {
  const previous = {name:'기존', age:70, gender:'none', goals:['daily'],configured:true};
  const outputs = {auto:false,laser:false,vibration:true,voice:false};
  const profile = profileFromForm(new Map([['name',' 새 별명 '],['age','']]), previous, outputs);
  assert.equal(profile.name,'새 별명');assert.equal(profile.age,null);
  assert.equal(profile.configured,true);
  assert.deepEqual(profile.goals,['fog','ankle','front']);
  assert.deepEqual(profile.outputs,outputs);assert.deepEqual(profile.preferredCues,['vibration']);
  assert.equal(previous.name,'기존');assert.equal(previous.age,70);
  assert.notEqual(profile.outputs,outputs);
});

test('optional age is not inferred as zero and invalid basic information cannot be saved', () => {
  assert.equal(profileFromForm(new Map([['name','사용자']])).age,null);
  assert.equal(profileFromForm(new Map([['name','사용자'],['age','68']])).age,68);
  for(const name of ['', '   ', '가'.repeat(25)]) assert.throws(()=>profileFromForm(new Map([['name',name]])));
  for(const age of ['0','121','-1','5.5','NaN','Infinity']) assert.throws(()=>profileFromForm(new Map([['name','사용자'],['age',age]])));
});

test('desktop and phone share two basic fields and offer all features without opt-in controls', () => {
  const state={profile:{configured:false,name:'시연 이름',age:68}};
  const html=renderOnboarding(state);
  assert.equal(renderMobileOnboarding(state),html);
  assert.deepEqual([...html.matchAll(/<input[^>]+name="([^"]+)"/g)].map(m=>m[1]),['name','age']);
  assert.doesNotMatch(html,/type="checkbox"|name="goals"|name="cues"|시연 이름|value="68"/);
  assert.equal((html.match(/class="app-feature app-feature-/g)||[]).length,3);
  assert.doesNotMatch(html,/name="age"[^>]*required/);
  const escaped=renderOnboarding({profile:{configured:true,name:'"><script>bad</script>',age:null}});
  assert.doesNotMatch(escaped,/<script>/);assert.match(escaped,/&lt;script&gt;/);
});
