#!/usr/bin/env node
/** Run: node --import tsx scripts/audit-i18n.cjs [--json path] [--strict] */
const ts=require('typescript'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const {translateEnglish}=require('../src/i18n/en.ts');
const written=require('../src/i18n/zh.json'),writtenTemplates=require('../src/i18n/zh-templates.json');
const writtenKeys=new Set(writtenTemplates.map(entry=>entry.source));
const hasCJK=value=>/[\u3400-\u9fff]/u.test(value);
const exact=new Set(),templates=new Set(),byFile={},localizedCatalogues={};
const files=['App.tsx','src/GameProvider.tsx','src/MultiplayerProvider.tsx'];
function walk(relative){for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){const name=path.join(relative,entry.name);if(entry.isDirectory())walk(name);else if(/\.tsx?$/.test(name)&&!name.includes('.test.'))files.push(name);}}
for(const directory of ['src/ui','src/map','src/game','src/data','src/multiplayer','server','shared'])walk(directory);
for(const file of files){
  const content=fs.readFileSync(path.join(root,file),'utf8');
  const source=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const values=[];
  function add(value,template=false){if(!hasCJK(value))return;(template?templates:exact).add(value);values.push(value);}
  function visit(node){
    // Only this explicit data catalogue owns parallel HK/Hant/English copies.
    // All other literals, including any outside copy(...) calls here, remain audited.
    if(['shared/trainingCourse.ts','shared/eliteCourse.ts'].includes(file)&&ts.isCallExpression(node)&&node.expression.getText(source)==='copy'){
      const args=node.arguments;
      if(args.length!==3||args.some(arg=>!ts.isStringLiteral(arg)||!arg.text.trim())||hasCJK(args[2].text))throw new Error('Invalid localized course catalogue copy');
      localizedCatalogues[file]=(localizedCatalogues[file]||0)+1;return;
    }
    if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))add(node.text);
    if(ts.isTemplateExpression(node))add(node.head.text+node.templateSpans.map((span,index)=>'${'+index+'}'+span.literal.text).join(''),true);
    if(ts.isJsxElement(node)&&(/Text$/.test(node.openingElement.tagName.getText(source))||['SectionLabel','SupportingText'].includes(node.openingElement.tagName.getText(source)))){
      let value='',slot=0,valid=true;
      for(const child of node.children){
        if(ts.isJsxText(child))value+=child.text.replace(/\s+/g,' ');
        else if(ts.isJsxExpression(child)){
          const expression=child.expression;if(!expression)continue;
          value+=ts.isStringLiteral(expression)||ts.isNoSubstitutionTemplateLiteral(expression)?expression.text:'${'+slot+++'}';
        }else{valid=false;break;}
      }
      if(valid)add(value.trim(),value.includes('${'));
    }
    ts.forEachChild(node,visit);
  }
  visit(source);byFile[file]=[...new Set(values)];
}
// Price caveats are visible UI but come from the data catalogue rather than literals.
for(const station of require('../assets/services/stations.json').stations){if(station.priceNote)exact.add(station.priceNote);}
const missing={writtenExact:[],writtenTemplates:[],englishExact:[],englishTemplates:[],englishCJK:[]};
for(const value of exact){
  if(!written[value])missing.writtenExact.push(value);
  const translated=translateEnglish(value);
  if(translated===undefined)missing.englishExact.push(value);
  else if(hasCJK(translated))missing.englishCJK.push({source:value,translated});
}
for(const source of templates){
  if(!writtenKeys.has(source))missing.writtenTemplates.push(source);
  const sample=source.replace(/\$\{(\d+)\}/gu,(_,index)=>'VALUE'+index);
  const translated=translateEnglish(sample);
  if(translated===undefined)missing.englishTemplates.push(source);
  else if(hasCJK(translated))missing.englishCJK.push({source,translated});
}
const inventory={exact:[...exact].sort(),templates:[...templates].sort(),byFile};
const report={localizedCatalogues,files:files.length,exact:exact.size,templates:templates.size,missing,inventory};
const output=process.argv.indexOf('--json');if(output>=0){const target=path.resolve(process.argv[output+1]);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({files:report.files,exact:report.exact,templates:report.templates,missing:Object.fromEntries(Object.entries(missing).map(([key,value])=>[key,value.length]))},null,2));
if(process.argv.includes('--strict')&&Object.values(missing).some(values=>values.length))process.exitCode=1;
