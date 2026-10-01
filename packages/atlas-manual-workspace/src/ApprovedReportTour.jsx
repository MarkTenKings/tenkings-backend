import React,{useState} from 'react';
import {filmSelector} from '../../atlas-report-view/src/film-selector.mjs';

/** Only this small launcher participates in the initial report/account render. */
export function ApprovedReportTour(props) {
 const [Component,setComponent]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 if(!filmSelector(props.reportUrl))return null;
 if(Component)return <Component {...props} initialOpen/>;
 async function open(){setLoading(true);setError('');try{const module=await import('./ApprovedReportTourDialog.jsx');setComponent(()=>module.default);}catch{setError('The tour is unavailable. Your report remains available.');}finally{setLoading(false);}}
 return <><button type="button"className="aft-launch"disabled={loading}onClick={open}>{loading?'Preparing tour…':props.label??'Take a tour'}</button>{error&&<p role="status">{error}</p>}</>;
}
export default ApprovedReportTour;
