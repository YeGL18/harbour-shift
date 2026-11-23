import test from 'node:test';
import assert from 'node:assert/strict';
import {RESET_QUESTIONS,gradeResetAnswers,RESET_COURSE_VERSION} from '../../shared/trainingCourse';
import {toSimplified} from './translate';
test('the explicitly localized reset catalogue has ten complete HK, formal Chinese and English questions and no English CJK',()=>{
  assert.equal(RESET_QUESTIONS.length,10);assert.equal(new Set(RESET_QUESTIONS.map(question=>question.id)).size,10);
  for(const question of RESET_QUESTIONS){assert.equal(question.choices.length,3);for(const copy of[question.prompt,...question.choices,question.explanation]){for(const key of['hk','zh','en']as const)assert.ok(copy[key].trim());assert.ok(!/[\u3400-\u9fff]/u.test(copy.en));assert.ok(toSimplified(copy.zh).length>0);}}
  const answers=RESET_QUESTIONS.map(question=>question.correct);assert.equal(gradeResetAnswers(RESET_COURSE_VERSION,answers).score,10);assert.equal(gradeResetAnswers(RESET_COURSE_VERSION,answers).passed,true);
  const misses=(n:number)=>answers.map((answer,index)=>index<n?(answer+1)%3:answer);
  assert.equal(gradeResetAnswers(RESET_COURSE_VERSION,misses(2)).passed,true);assert.equal(gradeResetAnswers(RESET_COURSE_VERSION,misses(3)).passed,false);
  assert.throws(()=>gradeResetAnswers('old-course',answers));assert.throws(()=>gradeResetAnswers(RESET_COURSE_VERSION,[...answers,0]));
});
