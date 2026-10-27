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
window.__fixtureUser={id:'responsive-owner',firstName:'Parent',unsafeMetadata:profile};
const card={inviteToken:'responsive-athlete',...profile,showHypeCard:true,showStats:true,showEvents:true,hypesEnabled:true,paused:false,photoUrl:null,cutoutUrl:null,cardAppearance:{design:'classic',jerseyNumber:'17'},timezone:'America/New_York',seasonEndsAt:'',projectId:null,replies:[],videos:[],scheduleEvents:[],events:[],favoriteMoment:null,liveScoreboard:null,liveTaps:{active:false,gameId:null,cheers:[],seasonCheers:[]},stats:{record:{wins:3,losses:1,ties:0},gamesPlayed:4,score:14,stats:{goals:7},games:[]}};
window.__unexpectedRequests=[];
window.fetch=async(input,init)=>{
  const path=new URL(typeof input==='string'?input:input.url,location.origin).pathname;
  let data;
  if(init?.method && init.method!=='GET') throw new Error('Geometry checks must not write data: '+path);
  if(path.endsWith('/athlete-invites')) data=[card];
  else if(path.endsWith('/responsive-athlete/fan')) data=card;
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
    element=<PublicPlayerShowcasePage params={{inviteToken:card.inviteToken}}/>;
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
