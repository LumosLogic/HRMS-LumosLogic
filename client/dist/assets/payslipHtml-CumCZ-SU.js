import{M as dt}from"./index-RSQwgDGU.js";const v={classic:{id:"classic",label:"Classic",description:"Plain black-and-grey grid. The original payslip layout.",accent:"#000000",titleBar:"lines",titleText:"#000000",tableHead:"#e8e8e8",tableHeadText:"#000000",border:"#aaaaaa",totals:"#f0f0f0",zebra:null},professional:{id:"professional",label:"Professional",description:"Navy title bar and table header with a clean ruled grid.",accent:"#1f2d5a",titleBar:"filled",titleText:"#ffffff",tableHead:"#1f2d5a",tableHeadText:"#ffffff",border:"#9aa3bd",totals:"#e9ecf5",zebra:null},modern:{id:"modern",label:"Modern",description:"Soft indigo accents, light borders and striped rows.",accent:"#3525cd",titleBar:"filled",titleText:"#ffffff",tableHead:"#ece9ff",tableHeadText:"#3525cd",border:"#d5d1f5",totals:"#f4f2ff",zebra:"#fafaff"}},ct=Object.values(v),st=[{value:"header",label:"Header (under company name)"},{value:"employee_info",label:"Employee details block"},{value:"footer",label:"Footer (above the note)"}];function lt(t){return v[t]||v.classic}const d=t=>Number(t||0),h=t=>Number(t||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}),a=t=>String(t!=null?t:"").replace(/[&<>"]/g,o=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[o]);function nt(t){const o=["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"],c=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];function n(e){return e<20?o[e]:e<100?c[Math.floor(e/10)]+(e%10?" "+o[e%10]:""):e<1e3?o[Math.floor(e/100)]+" Hundred"+(e%100?" "+n(e%100):""):e<1e5?n(Math.floor(e/1e3))+" Thousand"+(e%1e3?" "+n(e%1e3):""):e<1e7?n(Math.floor(e/1e5))+" Lakh"+(e%1e5?" "+n(e%1e5):""):n(Math.floor(e/1e7))+" Crore"+(e%1e7?" "+n(e%1e7):"")}const l=Math.floor(t),p=Math.round((t-l)*100);let x="Rupees "+(l>0?n(l):"Zero");return p>0&&(x+=" and "+n(p)+" Paise"),x+" Only"}const f=(t,o)=>`<div style="display:block;${t}">${o}</div>`,A=(t,o)=>(Array.isArray(t==null?void 0:t.payslip_custom_fields)?t.payslip_custom_fields:[]).filter(c=>c.position===o&&(c.label||c.value)),R=t=>`${a(t.label)}${t.label&&t.value?": ":""}${a(t.value)}`;function rt(t,o){const c=(t==null?void 0:t.payslip_company_fullname)||o||"",n=(t==null?void 0:t.payslip_company_cin)||"",l=(t==null?void 0:t.payslip_registered_address)||"",p=(t==null?void 0:t.payslip_corporate_address)||"",x=(t==null?void 0:t.payslip_contact_details)||"",e=(t==null?void 0:t.payslip_company_address)||"";let s=c?f("font-size:12px;font-weight:bold;line-height:1.5",a(c)):"";return n&&(s+=f("font-size:9px;color:#444;line-height:1.4;margin-top:2px",a(n))),l||p||x?(l&&(s+=f("font-size:8px;color:#222;font-weight:bold;line-height:1.5;margin-top:5px","Registered Office"),l.split(`
`).forEach(b=>{s+=f("font-size:8px;color:#444;line-height:1.4",a(b.trim()))})),p&&(s+=f("font-size:8px;color:#222;font-weight:bold;line-height:1.5;margin-top:5px","Corporate Office"),p.split(`
`).forEach(b=>{s+=f("font-size:8px;color:#444;line-height:1.4",a(b.trim()))})),x&&(s+=f("font-size:8px;color:#444;line-height:1.4;margin-top:5px",a(x)))):e&&e.split(`
`).forEach(b=>{s+=f("font-size:9px;color:#444;line-height:1.4",a(b.trim()))}),A(t,"header").forEach(b=>{s+=f("font-size:8px;color:#444;line-height:1.4;margin-top:2px",R(b))}),s}function it(t){return`
  .payslip{font-family:Arial,sans-serif;font-size:10px;color:#000}
  .payslip table{width:100%;border-collapse:collapse;font-size:9.5px}
  .payslip th,.payslip td{border:1px solid ${t.border};padding:4px 10px}
  .payslip th{background:${t.tableHead};color:${t.tableHeadText};font-weight:bold;text-align:left}
  .payslip .tright{text-align:right}
  .payslip .bold{font-weight:bold}
  .payslip .bg{background:${t.totals}}
  ${t.zebra?`.payslip tbody tr:nth-child(even) td{background:${t.zebra}}`:""}
  .payslip .note{font-size:8px;text-align:center;margin-top:12px;color:#555;border-top:1px solid #ddd;padding-top:6px}`}function bt({slip:t,settings:o,orgName:c,orgLogoUrl:n,statutory:l,banking:p,clBalance:x}){var O,D,M,C,I;const e=lt(o==null?void 0:o.payslip_template),s=typeof t.month=="string"?parseInt(t.month,10):d(t.month),b=dt[s-1]||t.month,N=[{label:"Basic",value:d(t.basic)},{label:"HRA",value:d(t.hra)},{label:"DA",value:d(t.da)},{label:"Conveyance",value:d(t.transport_allowance)},{label:"Medical Allowance",value:d(t.medical_allowance)},{label:"Special Allowance",value:d(t.special_allowance)},{label:"Other Allowance",value:d(t.other_allowances)}].filter(i=>i.value>0),S=[{label:"PF (Employee)",value:d(t.pf_employee)},{label:"ESI (Employee)",value:d(t.esi_employee)},{label:"PT",value:d(t.professional_tax)},{label:"TDS",value:d(t.tds)},{label:"Retention",value:d(t.retention)},{label:"Other Deductions",value:d(t.other_deductions)},{label:`LOP (${d(t.lop_days)} day${d(t.lop_days)===1?"":"s"})`,value:d(t.lop_amount)}].filter(i=>i.value>0),j=Math.max(N.length,S.length),T=d(t.gross_salary),B=d(t.total_deductions),z=d(t.net_salary),W=(l==null?void 0:l.pan_number)||"N/A",q=(l==null?void 0:l.esi_no)||"N/A",G=(l==null?void 0:l.pf_no)||"N/A",Y=(p==null?void 0:p.bank_name)||"N/A",w=(p==null?void 0:p.account_number)||"",J=w?w.slice(0,-4).replace(/\d/g,"*")+w.slice(-4):"N/A";let y={};try{y=typeof t.attendance_snapshot=="string"?JSON.parse(t.attendance_snapshot):t.attendance_snapshot||{}}catch{}const Z=(O=y.presentFull)!=null?O:d(t.present_days),K=(D=y.presentHalf)!=null?D:0,E=(M=y.weekoff)!=null?M:0,Q=(C=y.holiday)!=null?C:0,U=(I=y.paidLeave)!=null?I:d(t.leave_days),V=d(t.lop_days),P=d(t.working_days)+E,X=(o==null?void 0:o.payslip_footer_note)||"This is a computer generated salary slip and does not require a signature.",k=(o==null?void 0:o.payslip_company_pf_no)||"",F=(o==null?void 0:o.payslip_company_esic_no)||"",tt=rt(o,c),_=A(o,"employee_info"),H=[];for(let i=0;i<_.length;i+=2){const u=_[i],r=_[i+1];H.push(`<tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">${a(u.label)}</td>
        <td style="border:none;padding:2px 4px">: ${a(u.value)}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">${r?a(r.label):""}</td>
        <td style="border:none;padding:2px 4px">${r?": "+a(r.value):""}</td>
      </tr>`)}const et=A(o,"footer").map(i=>`<div style="text-align:center;font-size:8px;color:#444;margin-top:4px">${R(i)}</div>`).join(""),L=(o==null?void 0:o.payslip_watermark_mode)||"logo",ot=L==="text"&&(o!=null&&o.payslip_watermark_text)?`<div style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;display:flex;align-items:center;justify-content:center;overflow:hidden">
           <div style="transform:rotate(-35deg);font-size:84px;font-weight:bold;letter-spacing:6px;white-space:nowrap;color:${e.accent};opacity:0.09">${a(o.payslip_watermark_text)}</div>
         </div>`:L==="logo"?`<div style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;display:flex;align-items:center;justify-content:center;overflow:hidden">
             <img src="${n}" alt="" style="width:680px;max-width:95%;object-fit:contain;opacity:0.13" />
           </div>`:"",at=e.titleBar==="filled"?`text-align:center;font-weight:bold;font-size:11px;background:${e.accent};color:${e.titleText};padding:5px 0;margin:8px 0`:"text-align:center;font-weight:bold;font-size:11px;border-top:1px solid #999;border-bottom:1px solid #999;padding:4px 0;margin:8px 0",g=i=>`border:1px solid ${e.border};padding:2px 4px;text-align:center;font-weight:bold`,m=(i="")=>`border:1px solid ${e.border};padding:2px 4px;text-align:center;${i}`;return`
  <style>${it(e)}</style>
  <div class="payslip" style="position:relative;overflow:hidden">
    <table style="border:none;margin-bottom:8px;width:100%;table-layout:fixed">
      <tr>
        <td style="border:none;padding:0;width:45%;vertical-align:top">
          <img src="${n}" alt="${a(c)}"
            style="max-width:200px;max-height:80px;object-fit:contain" />
        </td>
        <td style="border:none;padding:0;width:55%;text-align:center;vertical-align:top;word-break:break-word;overflow-wrap:break-word">
          ${tt||`<div style="display:block;font-size:12px;font-weight:bold">${a(c)||"Organization"}</div>`}
        </td>
      </tr>
    </table>

    <div style="${at}">
      Salary Slip for the Month of ${b} ${t.year}
    </div>

    <table style="border:none;margin-bottom:8px;font-size:9.5px">
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px;width:15%">Employee ID</td>
        <td style="border:none;padding:2px 4px;width:35%">: ${a(t.employee_id||t.user_id)}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px;width:18%">Company P.F. No</td>
        <td style="border:none;padding:2px 4px">${k?": "+a(k):""}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Employee Name</td>
        <td style="border:none;padding:2px 4px">: ${a(t.name)}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">Company ESI No</td>
        <td style="border:none;padding:2px 4px">${F?": "+a(F):""}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Designation</td>
        <td style="border:none;padding:2px 4px">: ${a(t.position||"—")}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">P.F. No</td>
        <td style="border:none;padding:2px 4px">: ${a(G)}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Department</td>
        <td style="border:none;padding:2px 4px">: ${a(t.department||"—")}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">ESI No.</td>
        <td style="border:none;padding:2px 4px">: ${a(q)}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Bank Name</td>
        <td style="border:none;padding:2px 4px">: ${a(Y)}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">PAN No.</td>
        <td style="border:none;padding:2px 4px">: ${a(W)}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Bank A/c No.</td>
        <td style="border:none;padding:2px 4px">: ${a(J||"—")}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">Attendance</td>
        <td style="border:none;padding:2px 4px">: ${P} out of ${P}</td>
      </tr>
      ${H.join("")}
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
        ${Array.from({length:j}).map((i,u)=>{const r=N[u],$=S[u];return`<tr>
            <td>${(r==null?void 0:r.label)||""}</td>
            <td class="tright">${r?h(r.value):""}</td>
            <td>${(r==null?void 0:r.label)||""}</td>
            <td class="tright">${r?h(r.value):""}</td>
            <td>${($==null?void 0:$.label)||""}</td>
            <td class="tright">${$?h($.value):""}</td>
          </tr>`}).join("")}
      </tbody>
      <tfoot>
        <tr class="bg bold">
          <td>Total</td>
          <td class="tright">${h(T)}</td>
          <td>Gross</td>
          <td class="tright">${h(T)}</td>
          <td>Deduction</td>
          <td class="tright">${h(B)}</td>
        </tr>
        <tr>
          <td colspan="4" style="font-size:9px;font-style:italic;border-right:none">
            Amount in Words: ${nt(z)}
          </td>
          <td class="bold bg">Net Salary</td>
          <td class="tright bold">${h(z)}</td>
        </tr>
      </tfoot>
    </table>

    <table style="width:100%;border-collapse:collapse;font-size:8px;margin-top:6px;border-top:1px solid #ddd">
      <thead>
        <tr style="background:${e.totals}">
          <th style="${g()};background:${e.totals};color:#000">P+OD</th>
          <th style="${g()};background:${e.totals};color:#000">W/OFF</th>
          <th style="${g()};background:${e.totals};color:#000">LWP/LOP</th>
          <th style="${g()};background:${e.totals};color:#000">HL</th>
          <th style="${g()};background:${e.totals};color:#000">CL</th>
          <th style="${g()};background:${e.totals};color:#000;padding:2px 8px">Available CL Balance</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="${m()}">${(Z+K*.5).toFixed(2)}</td>
          <td style="${m()}">${E.toFixed(2)}</td>
          <td style="${m()}">${V.toFixed(2)}</td>
          <td style="${m()}">${Q.toFixed(2)}</td>
          <td style="${m()}">${U.toFixed(2)}</td>
          <td style="${m("padding:2px 8px")}">${x} Days</td>
        </tr>
      </tbody>
    </table>

    ${et}
    <div class="note">${a(X)}</div>
    <div style="text-align:center;font-size:7.5px;color:#aaa;margin-top:4px">HRMS by Lumos Logic</div>

    ${ot}
  </div>`}const ft=`
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;font-size:10px;color:#000;background:#fff}
  .payslip{max-width:800px;margin:10px auto;padding:20px;border:1px solid #ccc}
  @page{size:A4;margin:10mm}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;export{st as C,ct as P,ft as a,bt as b};
