export const showcaseGeometryScenarios = [
  'linked', 'long-labels', 'missing', 'unavailable', 'ambiguous', 'not-shared',
  'delayed-owner-invites', 'delayed-fan-card', 'retry-owner', 'retry-public',
] as const;
export type ShowcaseGeometryScenario = typeof showcaseGeometryScenarios[number];
export const longShowcaseLabels = {
  athleteName: 'Alexandria-Montgomery Maximiliana Worthington-Smythe',
  teamName: 'NorthwesternInternationalChampionshipAcademy United Development Club',
  seasonName: 'FallWinterInternationalChampionshipQualificationSeason 2026–2027',
};

// Deliberately no static route imports: each fresh document exercises a different
// first-import order, just as the lazy production routes do.
export function showcaseResponsiveFixture(base: string) {
  return `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {Router} from 'wouter';
import './src/index.css';
const profile={role:'fan',displayName:'Parent',athleteName:'Jordan Lee',teamName:'River FC',seasonName:'Fall Season',jerseyNumber:'17',position:'Striker',relationship:'parent',sport:'soccer',accessMode:'full'};
const scenario=new URLSearchParams(location.search).get('scenario')||'linked';
if(scenario!=='linked') Object.assign(profile,${JSON.stringify(longShowcaseLabels)});
window.__fixtureUser={id:'responsive-owner',firstName:'Parent',unsafeMetadata:profile};
const card={inviteToken:'responsive-athlete',...profile,showHypeCard:true,showStats:true,showEvents:true,hypesEnabled:true,paused:false,photoUrl:null,cutoutUrl:null,cardAppearance:{design:'classic',jerseyNumber:'17'},timezone:'America/New_York',seasonEndsAt:'',projectId:null,replies:[],videos:[],scheduleEvents:[],events:[],favoriteMoment:null,liveScoreboard:null,liveTaps:{active:false,gameId:null,cheers:[],seasonCheers:[]},stats:{record:{wins:3,losses:1,ties:0},gamesPlayed:4,score:14,stats:{goals:7},games:[]}};
const publicCardToken='responsive-public';
const ownerCards=scenario==='missing'?[]:scenario==='ambiguous'?
  [{...card,seasonName:profile.seasonName+' · Regional qualification'},{...card,inviteToken:'responsive-alternate',seasonName:profile.seasonName+' · National championship'}]:
  [{...card,showHypeCard:scenario!=='not-shared'},{...card,inviteToken:publicCardToken,athleteName:'Another athlete',teamName:'Another team',showHypeCard:scenario!=='not-shared'}];
window.__unexpectedRequests=[];window.__fixtureAttempts={ownerInvites:0,fanCard:0};window.__pendingFixtureRequests={};
const holdFixtureRequest=key=>new Promise(resolve=>{window.__pendingFixtureRequests[key]=resolve});
window.__releaseFixtureRequest=key=>{const release=window.__pendingFixtureRequests[key];if(!release)throw new Error('No delayed fixture request: '+key);delete window.__pendingFixtureRequests[key];release()};
window.fetch=async(input,init)=>{
  const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;
  let data;
  if(init?.method && init.method!=='GET') throw new Error('Geometry checks must not write data: '+path);
  if(path.endsWith('/athlete-invites')) {
    window.__fixtureAttempts.ownerInvites++;
    if(scenario==='delayed-owner-invites') await holdFixtureRequest('owner-invites');
    data=ownerCards;
  }
  else if(path.endsWith('/fan')) {
    window.__fixtureAttempts.fanCard++;
    if(scenario==='delayed-fan-card') await holdFixtureRequest('fan-card');
    if(scenario==='unavailable'||((scenario==='retry-owner'||scenario==='retry-public')&&window.__fixtureAttempts.fanCard===1)) return new Response(JSON.stringify({error:'Fixture card unavailable'}),{status:503,headers:{'Content-Type':'application/json'}});
    data={...card,inviteToken:path.split('/').at(-2)};
  }
  else if(path.endsWith('/projects')||path.endsWith('/hypes')||path.endsWith('/public-shoutouts')||path.endsWith('/live-tap-access-links')||path.endsWith('/hype-card-shares')) data=[];
  else if(path.endsWith('/editor-access')) data={status:'not_invited',emailAddress:null,projectId:null,updatedAt:null};
  else {window.__unexpectedRequests.push(path);throw new Error('Unstubbed geometry request: '+path);}
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
};
const root=createRoot(document.getElementById('root'));
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
window.__navigate=async path=>{
  const relative=path.slice(${base.length});
  history.pushState(null,'',path);
  dispatchEvent(new PopStateEvent('popstate'));
  let element;
  if(relative.startsWith('/studio/')){
    const {PlayerShowcasePage}=await import('./src/features/player-showcase');
    element=<PlayerShowcasePage profile={profile} userId="responsive-owner"/>;
  } else if(relative.startsWith('/player/')){
    const {OwnerAthleteInviteManagePage}=await import('./src/features/athlete-invite');
    element=<OwnerAthleteInviteManagePage params={{inviteToken:card.inviteToken}}/>;
  } else if(relative.startsWith('/showcase/')){
    const {PublicPlayerShowcasePage}=await import('./src/features/public-player-showcase');
    element=<PublicPlayerShowcasePage params={{inviteToken:publicCardToken}}/>;
  } else {
    const {LivingAthleteCardPage}=await import('./src/features/living-athlete-card');
    element=<LivingAthleteCardPage params={{inviteToken:card.inviteToken}}/>;
  }
  flushSync(()=>root.render(<QueryClientProvider client={client}><Router base="${base}"><React.Fragment key={path}>{element}</React.Fragment></Router></QueryClientProvider>));
};
document.addEventListener('click',event=>{
  const link=event.target.closest('a');
  if(!link||link.target==='_blank'||!link.pathname.startsWith('${base}/')) return;
  event.preventDefault();
  event.stopPropagation();
  window.__navigate(link.pathname+link.search+link.hash);
},true);
window.__navigate('${base}'+new URLSearchParams(location.search).get('route'));
`;
}
