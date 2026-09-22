import{aj as K,av as j,ag as t,M as oe,Y as me,$,au as he,at as fe,as as ue,ap as ge,s as ye,_ as ve}from"./index-WCsIXpyO.js";import{A as we}from"./Avatar-BFfczK7w.js";import{P as ne}from"./printer-Di_CzvUu.js";import{C as Ne}from"./circle-alert-C2gWYXrB.js";import{A as _e}from"./arrow-left-BV0E-D-V.js";import{D as je}from"./download-Bs5yZhes.js";const s=l=>Number(l||0),_=l=>Number(l||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});function $e(l){const x=["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"],b=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];function e(o){return o<20?x[o]:o<100?b[Math.floor(o/10)]+(o%10?" "+x[o%10]:""):o<1e3?x[Math.floor(o/100)]+" Hundred"+(o%100?" "+e(o%100):""):o<1e5?e(Math.floor(o/1e3))+" Thousand"+(o%1e3?" "+e(o%1e3):""):o<1e7?e(Math.floor(o/1e5))+" Lakh"+(o%1e5?" "+e(o%1e5):""):e(Math.floor(o/1e7))+" Crore"+(o%1e7?" "+e(o%1e7):"")}const f=Math.floor(l),c=Math.round((l-f)*100);let u="Rupees "+(f>0?e(f):"Zero");return c>0&&(u+=" and "+e(c)+" Paise"),u+" Only"}function ke(l,x){const b=(l==null?void 0:l.payslip_company_fullname)||x||"",e=(l==null?void 0:l.payslip_company_cin)||"",f=(l==null?void 0:l.payslip_registered_address)||"",c=(l==null?void 0:l.payslip_corporate_address)||"",u=(l==null?void 0:l.payslip_contact_details)||"",o=(l==null?void 0:l.payslip_company_address)||"",d=(p,a)=>`<div style="display:block;${p}">${a}</div>`;let h=b?d("font-size:12px;font-weight:bold;line-height:1.5",b):"";return e&&(h+=d("font-size:9px;color:#444;line-height:1.4;margin-top:2px",e)),f||c||u?(f&&(h+=d("font-size:8px;color:#222;font-weight:bold;line-height:1.5;margin-top:5px","Registered Office"),f.split(`
`).forEach(p=>{h+=d("font-size:8px;color:#444;line-height:1.4",p.trim())})),c&&(h+=d("font-size:8px;color:#222;font-weight:bold;line-height:1.5;margin-top:5px","Corporate Office"),c.split(`
`).forEach(p=>{h+=d("font-size:8px;color:#444;line-height:1.4",p.trim())})),u&&(h+=d("font-size:8px;color:#444;line-height:1.4;margin-top:5px",u))):o&&o.split(`
`).forEach(p=>{h+=d("font-size:9px;color:#444;line-height:1.4",p.trim())}),h}function Ae({payslipId:l,onClose:x}){var Z,V,ee,te,ae;const b=K.useRef(null),{data:e,isLoading:f}=j({queryKey:["payslip-details",l],queryFn:()=>$(`/payroll/payslips/${l}/details`),enabled:!!l}),{data:c,isFetched:u}=j({queryKey:["org-settings"],queryFn:()=>$("/org/settings"),staleTime:5*60*1e3,retry:1}),{data:o}=j({queryKey:["payroll-settings"],queryFn:()=>$("/payroll/settings"),staleTime:5*60*1e3}),{data:d}=j({queryKey:["emp-statutory",e==null?void 0:e.user_id],queryFn:()=>$(`/profile/${e.user_id}/statutory`),enabled:!!(e!=null&&e.user_id)}),{data:h}=j({queryKey:["emp-banking",e==null?void 0:e.user_id],queryFn:()=>$(`/profile/${e.user_id}/banking`),enabled:!!(e!=null&&e.user_id)}),p=Array.isArray(h)?h[0]:h,{data:a}=j({queryKey:["emp-leave-balance-payslip",e==null?void 0:e.user_id],queryFn:()=>$("/leaves/balance",{userId:e.user_id}),enabled:!!(e!=null&&e.user_id),staleTime:5*60*1e3}),O=(()=>{const m=((a==null?void 0:a.balances)||[]).find(i=>{var g;return i.leave_type==="casual"||((g=i.label)==null?void 0:g.toLowerCase().includes("casual"))});return m?m.remaining.toFixed(2):"0.00"})();function k(){var le;const w=(le=b.current)==null?void 0:le.innerHTML;if(!w)return;const m=window.open("","_blank","width=900,height=700");m.document.write(`<!DOCTYPE html><html><head><title>Payslip - ${(e==null?void 0:e.name)||""}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:Arial,sans-serif;font-size:10px;color:#000;background:#fff}
        .payslip{max-width:800px;margin:10px auto;padding:20px;border:1px solid #ccc}
        table{width:100%;border-collapse:collapse;font-size:9.5px}
        th,td{border:1px solid #aaa;padding:4px 10px}
        th{background:#e8e8e8;font-weight:bold;text-align:left}
        .tright{text-align:right}
        .bold{font-weight:bold}
        .bg{background:#f0f0f0}
        .note{font-size:8px;text-align:center;margin-top:12px;color:#555;border-top:1px solid #ddd;padding-top:6px}
        @page{size:A4;margin:10mm}
        @media print{body{-webkit-print-color-adjust:exact}}
      </style></head><body>${w}</body></html>`),m.document.close(),m.focus();const i=m.document.images;if(i.length===0){m.print(),m.close();return}let g=0;const be=i.length,I=()=>{++g>=be&&(m.print(),m.close())};Array.from(i).forEach(B=>{B.complete?I():(B.onload=I,B.onerror=I)})}if(f||!u)return t.jsx("div",{className:"fixed inset-0 z-50 flex items-center justify-center bg-black/50",children:t.jsxs("div",{className:"bg-white rounded-2xl p-8 flex items-center gap-3",children:[t.jsx("span",{className:"w-5 h-5 border-2 border-[#3525cd]/20 border-t-[#3525cd] rounded-full animate-spin"}),t.jsx("span",{className:"text-sm text-[#464555]",children:"Loading payslip…"})]})});if(!e)return null;const S=typeof e.month=="string"?parseInt(e.month,10):s(e.month),E=oe[S-1]||e.month,z=[{label:"Basic",value:s(e.basic)},{label:"HRA",value:s(e.hra)},{label:"DA",value:s(e.da)},{label:"Conveyance",value:s(e.transport_allowance)},{label:"Medical Allowance",value:s(e.medical_allowance)},{label:"Special Allowance",value:s(e.special_allowance)},{label:"Other Allowance",value:s(e.other_allowances)}].filter(w=>w.value>0),P=[{label:"PF (Employee)",value:s(e.pf_employee)},{label:"ESI (Employee)",value:s(e.esi_employee)},{label:"PT",value:s(e.professional_tax)},{label:"TDS",value:s(e.tds)},{label:"Retention",value:s(e.retention)},{label:"Other Deductions",value:s(e.other_deductions)},{label:`LOP (${s(e.lop_days)} day${s(e.lop_days)===1?"":"s"})`,value:s(e.lop_amount)}].filter(w=>w.value>0),C=Math.max(z.length,P.length),T=s(e.gross_salary),H=s(e.total_deductions),L=s(e.net_salary),F=(d==null?void 0:d.pan_number)||"N/A";d!=null&&d.uan_no;const n=(d==null?void 0:d.esi_no)||"N/A",N=(d==null?void 0:d.pf_no)||"N/A",R=(p==null?void 0:p.bank_name)||"N/A",y=(p==null?void 0:p.account_number)||"",se=y?y.slice(0,-4).replace(/\d/g,"*")+y.slice(-4):"N/A";let A={};try{A=typeof e.attendance_snapshot=="string"?JSON.parse(e.attendance_snapshot):e.attendance_snapshot||{}}catch{}const G=(Z=A.presentFull)!=null?Z:s(e.present_days),M=(V=A.presentHalf)!=null?V:0,U=(ee=A.weekoff)!=null?ee:0,de=(te=A.holiday)!=null?te:0,re=(ae=A.paidLeave)!=null?ae:s(e.leave_days),ie=s(e.lop_days),Y=s(e.working_days)+U;(G+M*.5).toFixed(M?1:0);const q=(c==null?void 0:c.name)||"",ce=(o==null?void 0:o.payslip_footer_note)||"This is a computer generated salary slip and does not require a signature.",J=(c==null?void 0:c.logo_url)||(typeof window!="undefined"?`${window.location.origin}/LogoWithoutName.svg`:"/LogoWithoutName.svg"),Q=(o==null?void 0:o.payslip_company_pf_no)||"",X=(o==null?void 0:o.payslip_company_esic_no)||"",pe=ke(o,q),xe=`
  <div class="payslip" style="position:relative;overflow:hidden">
    <table style="border:none;margin-bottom:8px;width:100%;table-layout:fixed">
      <tr>
        <td style="border:none;padding:0;width:45%;vertical-align:top">
          <img src="${J}" alt="${q}"
            style="max-width:200px;max-height:80px;object-fit:contain" />
        </td>
        <td style="border:none;padding:0;width:55%;text-align:center;vertical-align:top;word-break:break-word;overflow-wrap:break-word">
          ${pe||`<div style="display:block;font-size:12px;font-weight:bold">${q||"Organization"}</div>`}
        </td>
      </tr>
    </table>

    <div style="text-align:center;font-weight:bold;font-size:11px;border-top:1px solid #999;border-bottom:1px solid #999;padding:4px 0;margin:8px 0">
      Salary Slip for the Month of ${E} ${e.year}
    </div>

    <table style="border:none;margin-bottom:8px;font-size:9.5px">
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px;width:15%">Employee ID</td>
        <td style="border:none;padding:2px 4px;width:35%">: ${e.employee_id||e.user_id}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px;width:18%">Company P.F. No</td>
        <td style="border:none;padding:2px 4px">${Q?": "+Q:""}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Employee Name</td>
        <td style="border:none;padding:2px 4px">: ${e.name}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">Company ESI No</td>
        <td style="border:none;padding:2px 4px">${X?": "+X:""}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Designation</td>
        <td style="border:none;padding:2px 4px">: ${e.position||"—"}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">P.F. No</td>
        <td style="border:none;padding:2px 4px">: ${N}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Department</td>
        <td style="border:none;padding:2px 4px">: ${e.department||"—"}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">ESI No.</td>
        <td style="border:none;padding:2px 4px">: ${n}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Bank Name</td>
        <td style="border:none;padding:2px 4px">: ${R}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">PAN No.</td>
        <td style="border:none;padding:2px 4px">: ${F}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Bank A/c No.</td>
        <td style="border:none;padding:2px 4px">: ${se||"—"}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">Attendance</td>
        <td style="border:none;padding:2px 4px">: ${Y} out of ${Y}</td>
      </tr>
    </table>

    <table>
      <thead>
        <tr>
          <th style="width:25%">Actuals</th>
          <th style="width:12%;text-align:right">Amount(Rs)</th>
          <th style="width:25%">Earnings</th>
          <th style="width:12%;text-align:right">Amount(Rs)</th>
          <th style="width:15%">Deductions</th>
          <th style="width:11%;text-align:right">Amount(Rs)</th>
        </tr>
      </thead>
      <tbody>
        ${Array.from({length:C}).map((w,m)=>{const i=z[m],g=P[m];return`<tr>
            <td>${(i==null?void 0:i.label)||""}</td>
            <td class="tright">${i?_(i.value):""}</td>
            <td>${(i==null?void 0:i.label)||""}</td>
            <td class="tright">${i?_(i.value):""}</td>
            <td>${(g==null?void 0:g.label)||""}</td>
            <td class="tright">${g?_(g.value):""}</td>
          </tr>`}).join("")}
      </tbody>
      <tfoot>
        <tr class="bg bold">
          <td>Total</td>
          <td class="tright">${_(T)}</td>
          <td>Gross</td>
          <td class="tright">${_(T)}</td>
          <td>Deduction</td>
          <td class="tright">${_(H)}</td>
        </tr>
        <tr>
          <td colspan="4" style="font-size:9px;font-style:italic;border-right:none">
            Amount in Words: ${$e(L)}
          </td>
          <td class="bold bg">Net Salary</td>
          <td class="tright bold">${_(L)}</td>
        </tr>
      </tfoot>
    </table>

    <table style="width:100%;border-collapse:collapse;font-size:8px;margin-top:6px;border-top:1px solid #ddd">
      <thead>
        <tr style="background:#f0f0f0">
          <th style="border:1px solid #aaa;padding:2px 4px;text-align:center;font-weight:bold">P+OD</th>
          <th style="border:1px solid #aaa;padding:2px 4px;text-align:center;font-weight:bold">W/OFF</th>
          <th style="border:1px solid #aaa;padding:2px 4px;text-align:center;font-weight:bold">LWP/LOP</th>
          <th style="border:1px solid #aaa;padding:2px 4px;text-align:center;font-weight:bold">HL</th>
          <th style="border:1px solid #aaa;padding:2px 4px;text-align:center;font-weight:bold">CL</th>
          <th style="border:1px solid #aaa;padding:2px 8px;text-align:center;font-weight:bold">Available CL Balance</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="border:1px solid #aaa;padding:2px 4px;text-align:center">${(G+M*.5).toFixed(2)}</td>
          <td style="border:1px solid #aaa;padding:2px 4px;text-align:center">${U.toFixed(2)}</td>
          <td style="border:1px solid #aaa;padding:2px 4px;text-align:center">${ie.toFixed(2)}</td>
          <td style="border:1px solid #aaa;padding:2px 4px;text-align:center">${de.toFixed(2)}</td>
          <td style="border:1px solid #aaa;padding:2px 4px;text-align:center">${re.toFixed(2)}</td>
          <td style="border:1px solid #aaa;padding:2px 8px;text-align:center">${O} Days</td>
        </tr>
      </tbody>
    </table>

    <div class="note">${ce}</div>
    <div style="text-align:center;font-size:7.5px;color:#aaa;margin-top:4px">HRMS by Lumos Logic</div>

    <!-- Company logo watermark — absolutely covers the full payslip area -->
    <div style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;display:flex;align-items:center;justify-content:center;overflow:hidden">
      <img src="${J}" alt="" style="width:680px;max-width:95%;object-fit:contain;opacity:0.13" />
    </div>
  </div>`;return t.jsx("div",{className:"fixed inset-0 z-[70] flex items-center justify-center p-4",style:{background:"rgba(4,6,14,.7)"},children:t.jsxs("div",{className:"bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col",children:[t.jsxs("div",{className:"flex items-center justify-between px-6 py-3 border-b border-[#e7eefe] flex-shrink-0",children:[t.jsxs("div",{children:[t.jsxs("p",{className:"font-black text-[#151c27] text-sm",children:["Salary Slip — ",e.name]}),t.jsxs("p",{className:"text-xs text-[#777587]",children:[E," ",e.year]})]}),t.jsxs("div",{className:"flex items-center gap-2",children:[t.jsxs("button",{onClick:k,className:"flex items-center gap-1.5 px-3 py-2 bg-[#3525cd] text-white rounded-xl text-xs font-bold hover:bg-[#2a1fb0] transition-colors",children:[t.jsx(ne,{size:13})," Print / Save PDF"]}),t.jsx("button",{onClick:x,className:"w-8 h-8 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center",children:t.jsx(me,{size:16,className:"text-[#777587]"})})]})]}),t.jsx("div",{className:"overflow-y-auto flex-1 p-4 bg-[#f8f9ff]",children:t.jsx("div",{ref:b,className:"bg-white shadow-sm",dangerouslySetInnerHTML:{__html:xe}})})]})})}const v=l=>"₹"+Number(l||0).toLocaleString("en-IN",{minimumFractionDigits:2}),r=l=>Number(l||0);function D({label:l,value:x,accent:b,bold:e}){return t.jsxs("tr",{className:"border-b border-[#f0eef8] last:border-0",children:[t.jsx("td",{className:"py-2.5 text-sm text-[#464555]",children:l}),t.jsx("td",{className:`py-2.5 text-sm text-right ${e?"font-black":"font-medium"} ${b||"text-[#151c27]"}`,children:x})]})}function W({title:l,children:x}){return t.jsxs("div",{className:"bg-white border border-[#e2e0f0] rounded-xl overflow-hidden",children:[t.jsx("div",{className:"px-5 py-3 border-b border-[#e2e0f0] bg-[#f9f9ff]",children:t.jsx("p",{className:"text-[0.7rem] font-black uppercase tracking-widest text-[#777587]",children:l})}),t.jsx("div",{className:"px-5 py-1",children:t.jsx("table",{className:"w-full",children:x})})]})}function ze(){const{id:l}=he(),x=fe(),b=ue(),{user:e}=ge(),[f,c]=K.useState(!1),[u,o]=K.useState(!1);async function d(){var n;o(!0);try{const N=await ve(`/payroll/payslips/${l}/pdf`),R=URL.createObjectURL(N),y=document.createElement("a");y.href=R,y.download=`Payslip_${((n=a==null?void 0:a.name)==null?void 0:n.replace(/\s+/g,"_"))||"payslip"}_${a==null?void 0:a.month}_${a==null?void 0:a.year}.pdf`,document.body.appendChild(y),y.click(),document.body.removeChild(y),URL.revokeObjectURL(R)}catch(N){alert(N.message||"Download failed")}finally{o(!1)}}const p=(e==null?void 0:e.role)==="root_admin"?"/root":"";b.pathname.startsWith("/root/")||b.pathname.startsWith("/payroll/");const{data:a,isLoading:O,error:k}=j({queryKey:["payslip-details",l],queryFn:()=>$(`/payroll/payslips/${l}/details`),enabled:!!l}),S=()=>{var n;(n=b.state)!=null&&n.from?x(b.state.from):window.history.length>1?x(-1):x(`${p}/payroll/generate`)};if(O)return t.jsx("div",{className:"flex justify-center py-24",children:t.jsx("span",{className:"w-7 h-7 border-2 border-[#3525cd]/20 border-t-[#3525cd] rounded-full animate-spin"})});if(k||!a)return t.jsxs("div",{className:"text-center py-24",children:[t.jsx(Ne,{size:36,className:"text-red-400 mx-auto mb-3"}),t.jsx("p",{className:"text-sm text-[#777587]",children:(k==null?void 0:k.message)||"Payslip not found"}),t.jsx("button",{onClick:S,className:"mt-4 text-sm text-[#3525cd] font-bold hover:underline",children:"Go back"})]});const E=typeof a.month=="string"?parseInt(a.month,10):r(a.month),z=oe[E-1]||a.month,P=r(a.gross_salary),C=r(a.total_deductions),T=r(a.net_salary),H=[{label:"Basic",value:r(a.basic)},{label:"HRA",value:r(a.hra)},{label:"Dearness Allowance",value:r(a.da)},{label:"Transport Allowance",value:r(a.transport_allowance)},{label:"Medical Allowance",value:r(a.medical_allowance)},{label:"Special Allowance",value:r(a.special_allowance||0)},{label:"Other Allowances",value:r(a.other_allowances||0)}].filter(n=>n.value>0),L=[{label:"Provident Fund (Employee)",value:r(a.pf_employee)},{label:"ESI (Employee)",value:r(a.esi_employee)},{label:"Professional Tax",value:r(a.professional_tax)},{label:"TDS",value:r(a.tds)},{label:"Other Deductions",value:r(a.other_deductions)},{label:`LOP (${r(a.lop_days)} day${r(a.lop_days)===1?"":"s"})`,value:r(a.lop_amount)}].filter(n=>n.value>0),F=[{label:"Provident Fund (Employer)",value:r(a.pf_employer)},{label:"ESI (Employer)",value:r(a.esi_employer)}].filter(n=>n.value>0);return t.jsxs("div",{className:"space-y-6 max-w-3xl",children:[t.jsxs("div",{className:"flex items-center justify-between",children:[t.jsxs("button",{onClick:S,className:"flex items-center gap-1.5 text-sm text-[#777587] hover:text-[#3525cd] font-medium transition-colors",children:[t.jsx(_e,{size:15}),"Back"]}),t.jsxs("div",{className:"flex items-center gap-2",children:[t.jsxs("button",{onClick:d,disabled:u,className:"flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#3525cd] text-white text-xs font-bold hover:bg-[#2a1fb0] transition-colors disabled:opacity-50",children:[u?t.jsx("span",{className:"w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"}):t.jsx(je,{size:13}),"Download PDF"]}),t.jsxs("button",{onClick:()=>c(!0),className:"flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#c7c4d8] text-xs font-bold text-[#464555] hover:bg-[#f0f3ff] transition-colors",children:[t.jsx(ne,{size:13})," Print"]})]})]}),f&&t.jsx(Ae,{payslipId:l,onClose:()=>c(!1)}),t.jsxs("div",{className:"bg-white border border-[#e2e0f0] rounded-xl p-5",children:[t.jsxs("div",{className:"flex items-start justify-between gap-4 flex-wrap",children:[t.jsxs("div",{className:"flex items-center gap-3",children:[t.jsx(we,{name:a.name,size:44,color:a.avatar_color}),t.jsxs("div",{children:[t.jsx("p",{className:"font-black text-[#151c27] text-base",children:a.name}),t.jsxs("p",{className:"text-xs text-[#777587]",children:[a.employee_id&&t.jsxs("span",{children:[a.employee_id," · "]}),a.department||a.position||"Employee"]})]})]}),t.jsxs("div",{className:"flex items-center gap-3",children:[t.jsxs("div",{className:"text-right",children:[t.jsx("p",{className:"text-[0.65rem] font-black uppercase tracking-widest text-[#777587]",children:"Pay Period"}),t.jsxs("p",{className:"font-black text-[#151c27]",children:[z," ",a.year]})]}),a.locked&&t.jsxs("span",{className:"inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600",children:[t.jsx(ye,{size:11}),"Locked"]})]})]}),t.jsx("div",{className:"mt-4 pt-4 border-t border-[#e2e0f0] grid grid-cols-3 gap-0 divide-x divide-[#e2e0f0]",children:[{label:"Gross Salary",value:v(P)},{label:"Total Deductions",value:v(C),accent:"text-rose-600"},{label:"Net Pay",value:v(T),accent:"text-emerald-700",bold:!0}].map(n=>t.jsxs("div",{className:"px-4 first:pl-0 last:pr-0",children:[t.jsx("p",{className:"text-[0.65rem] font-black uppercase tracking-widest text-[#777587]",children:n.label}),t.jsx("p",{className:`text-lg font-black ${n.accent||"text-[#151c27]"}`,children:n.value})]},n.label))})]}),t.jsxs(W,{title:"Earnings",children:[H.map(n=>t.jsx(D,{label:n.label,value:v(n.value)},n.label)),t.jsx(D,{label:"Gross Salary",value:v(P),bold:!0,accent:"text-[#3525cd]"})]}),L.length>0&&t.jsxs(W,{title:"Deductions",children:[L.map(n=>t.jsx(D,{label:n.label,value:v(n.value),accent:"text-rose-600"},n.label)),t.jsx(D,{label:"Total Deductions",value:v(C),bold:!0,accent:"text-rose-700"})]}),F.length>0&&t.jsxs(W,{title:"Employer Contributions (CTC)",children:[F.map(n=>t.jsx(D,{label:n.label,value:v(n.value),accent:"text-slate-600"},n.label)),t.jsx(D,{label:"Total Employer Contribution",value:v(F.reduce((n,N)=>n+N.value,0)),bold:!0,accent:"text-slate-700"})]}),t.jsxs("div",{className:"bg-white border border-[#e2e0f0] rounded-xl overflow-hidden",children:[t.jsx("div",{className:"px-5 py-3 border-b border-[#e2e0f0] bg-[#f9f9ff]",children:t.jsx("p",{className:"text-[0.7rem] font-black uppercase tracking-widest text-[#777587]",children:"Attendance Summary"})}),t.jsx("div",{className:"grid grid-cols-2 sm:grid-cols-4 divide-x divide-[#e2e0f0]",children:[{label:"Working Days",value:a.working_days||0},{label:"Present Days",value:r(a.present_days)},{label:"Absent Days",value:a.absent_days||0},{label:"LOP Days",value:r(a.lop_days)}].map(n=>t.jsxs("div",{className:"px-5 py-3",children:[t.jsx("p",{className:"text-[0.65rem] font-black uppercase tracking-widest text-[#777587]",children:n.label}),t.jsx("p",{className:"text-lg font-black text-[#151c27]",children:n.value})]},n.label))})]}),t.jsxs("div",{className:"text-xs text-[#777587] space-y-0.5 pb-6",children:[a.formula_version&&t.jsxs("p",{children:["Calculation engine: v",a.formula_version]}),a.generated_at&&t.jsxs("p",{children:["Generated: ",new Date(a.generated_at||a.created_at).toLocaleString("en-IN")]}),a.locked&&a.locked_at&&t.jsxs("p",{children:["Locked: ",new Date(a.locked_at).toLocaleString("en-IN")]})]})]})}export{ze as default};
