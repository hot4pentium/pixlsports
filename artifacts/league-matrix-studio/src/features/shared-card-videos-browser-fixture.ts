/** Uses the public manifest contract; no uploads, follows, or owner settings. */
export const sharedCardVideosFixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {LivingAthleteCardPage} from './src/features/living-athlete-card';
import './src/index.css';
import './src/features/living-athlete-card.css';
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
window.__requests=[];
window.fetch=async(input,init)=>{
 const url=String(input instanceof Request?input.url:input);
 window.__requests.push({url,method:init?.method||'GET'});
 if(url.includes('/athlete-invites/phone-videos/fan')){
  const videos=new URLSearchParams(location.search).has('empty')?[]:[
   {shareToken:'real-clip',title:'Game highlight',mediaName:'Hosted clip',videoUrl:'/api/hype-card-shares/real-clip/media/video',posterUrl:null},
   {shareToken:'broken-clip',title:'Unavailable highlight',mediaName:'Unavailable clip',videoUrl:'/api/hype-card-shares/broken-clip/media/video',posterUrl:null}
  ];
  return new Response(JSON.stringify({
   inviteToken:'phone-videos',athleteName:'Jordan',teamName:'City Hoops',seasonName:'Fall season',
   seasonEndsAt:new Date(Date.now()+86400000*90).toISOString(),timezone:'UTC',sport:'basketball',
   hypesEnabled:false,photoUrl:null,cutoutUrl:null,hypeCard:null,cardAppearance:null,
   videos,stats:null,scheduleEvents:[],showEvents:true,events:[],replies:[],liveScoreboard:null,
   liveTaps:{active:false,gameId:null,cheers:[],seasonCheers:[]}
  }),{headers:{'Content-Type':'application/json'}});
 }
 throw Error('Unexpected application request: '+url);
};
createRoot(document.getElementById('root')).render(
 <QueryClientProvider client={client}><LivingAthleteCardPage params={{inviteToken:'phone-videos'}}/></QueryClientProvider>
);
`;
