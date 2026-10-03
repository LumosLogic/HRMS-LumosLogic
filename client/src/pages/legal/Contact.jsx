import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Trash2, LifeBuoy, FileText, Info } from 'lucide-react';
import LegalLayout from '@/components/layout/LegalLayout';
import { PageHero, Prose, Section, P, UL, Divider } from '@/components/legal/LegalKit';

const SUPPORT_EMAIL = 'hello@lumoslogic.com';

export default function Contact() {
  return (
    <LegalLayout
      title="Lumos Logic HRMS Contact & Support"
      description="Contact Lumos Logic HRMS support for general help, privacy inquiries, data deletion requests and security concerns."
      path="/contact"
    >
      <PageHero
        eyebrow="Support"
        title="Contact & Support"
        subtitle="How to reach the Lumos Logic HRMS team for help, privacy, data and security matters."
      />

      <Prose>
        <P>
          We&rsquo;re here to help. Choose the topic below to find the right way to reach us. For the fastest resolution on issues
          related to your account or records, please also reach out to your organization&rsquo;s HR administrator, who manages your workspace.
        </P>

        <div className="grid sm:grid-cols-2 gap-4 my-8">
          {[
            { icon: <LifeBuoy size={22} />, title: 'General & HRMS Support', desc: 'Questions about using the platform, features, or troubleshooting.', to: SUPPORT_EMAIL, mail: true },
            { icon: <ShieldCheck size={22} />, title: 'Security Concerns', desc: 'Report a suspected vulnerability or security issue.', to: SUPPORT_EMAIL, mail: true },
            { icon: <FileText size={22} />, title: 'Privacy Inquiries', desc: 'Questions or requests about how your data is handled.', to: SUPPORT_EMAIL, mail: true },
            { icon: <Trash2 size={22} />, title: 'Data Deletion Requests', desc: 'Request deletion of your account or data.', to: '/account-deletion', mail: false },
          ].map(c => (
            <div key={c.title} className="rounded-2xl border border-[#e7eefe] bg-white p-5">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-3.5"
                style={{ background: 'rgba(53,37,205,.08)', color: '#3525cd' }}>
                {c.icon}
              </div>
              <h3 className="text-sm font-black text-[#151c27] mb-1.5">{c.title}</h3>
              <p className="text-sm text-[#464555] leading-relaxed mb-3">{c.desc}</p>
              {c.mail ? (
                <a href={`mailto:${c.to}`} className="text-sm font-bold text-[#3525cd] hover:underline break-all">{c.to}</a>
              ) : (
                <Link to={c.to} className="text-sm font-bold text-[#3525cd] hover:underline">Request deletion →</Link>
              )}
            </div>
          ))}
        </div>

        <Section id="email" title="Email">
          <P>
            For all support, privacy, security and deletion inquiries, email us at
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#3525cd] font-semibold hover:underline"> {SUPPORT_EMAIL}</a>.
            When writing about an account, include your full name, work email and organization name so we can route your request correctly.
          </P>
        </Section>

        <Section id="what-to-include" title="What to Include">
          <UL items={[
            <>Your full name and the work email associated with your HRMS account.</>,
            <>Your organization&rsquo;s name (if applicable).</>,
            <>A clear description of the issue or request.</>,
            <>Any relevant screenshots or error messages (do not include passwords).</>,
          ]} />
        </Section>

        <Section id="employer" title="Account & Record Requests">
          <P>
            Because employee accounts are managed by your organization, many requests — such as correcting your profile or updating your
            records — are handled fastest by your organization&rsquo;s HR administrator. If you are unsure who that is, contact us and we will
            help direct you.
          </P>
        </Section>

        <Section id="security" title="Report a Security Concern">
          <P>
            If you believe you have found a security vulnerability or have experienced a security incident involving Lumos Logic HRMS,
            please email us at
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#3525cd] font-semibold hover:underline"> {SUPPORT_EMAIL}</a> with as much
            detail as possible. Please do not include live credentials. For more information, see our
            <Link to="/security" className="text-[#3525cd] font-semibold hover:underline"> Security &amp; Data Protection</Link> page.
          </P>
        </Section>

        <Divider />
        <P className="text-sm text-[#777587] flex items-center gap-1.5">
          <Info size={14} /> Lumos Logic HRMS is a product of Lumos Logic.
        </P>
      </Prose>
    </LegalLayout>
  );
}
