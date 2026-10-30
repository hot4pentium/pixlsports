
import React from 'react';
import {createRoot} from 'react-dom/client';
import {AccountLoadingScreen} from './src/features/account-loading-screen';
import './src/index.css';
const root=createRoot(document.getElementById('root'));
window.__retryCount=0;
window.__showError=error=>root.render(<AccountLoadingScreen error={error} onRetry={()=>window.__retryCount++}/>);
window.__showError(false);
