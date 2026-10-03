import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, KeyRound, Lock, Users, ServerCog, Eye, RefreshCw, AlertTriangle } from 'lucide-react';
import LegalLayout from '@/components/layout/LegalLayout';
import { PageHero, Prose, Section, Sub, P, UL, Callout, Divider } from '@/components/legal/LegalKit';

const LAST_UPDATED = 'October 3, 2026';

export default function Security() {
  return (
    <LegalLayout
      title="Lumos Logic HRMS Security & Data Protection"
      description="Security and data protection practices of Lumos Logic HRMS, including authentication, access control and how to report security concerns."
      path="/security"
    >
      <PageHero
        eyebrow="Trust"
        title="Security & Data Protection"
        subtitle="An overview of how Lumos Logic HRMS is designed to protect your organization's data."
        meta={[`Last Updated: ${LAST_UPDATED}`]}
      />

      <Prose>
        <P>
          We design Lumos Logic HRMS with security in mind. This page describes the security practices implemented in the platform.
          We do not claim any third-party security certification, and this page should not be read as a guarantee of absolute security.
        </P>

        <div className="grid sm:grid-cols-2 gap-4 my-6">
          {[
            { icon: <KeyRound size={20} />, label: 'Hashed passwords', desc: 'Passwords are stored using one-way hashing, never plain text.' },
            { icon: <Lock size={20} />, label: 'Token-based sessions', desc: 'Authentication uses signed JSON Web Tokens (JWT) with expiry.' },
            { icon: <Users size={20} />, label: 'Role-based access', desc: 'Granular permissions per module, role and organization.' },
            { icon: <ServerCog size={20} />, label: 'Tenant isolation', desc: 'Data is separated per organization (multi-tenancy).' },
            { icon: <Eye size={20} />, label: 'Rate limiting', desc: 'API requests are rate limited to reduce abuse.' },
            { icon: <RefreshCw size={20} />, label: 'Ongoing updates', desc: 'Regular maintenance and security fixes.' },
          ].map(x => (
            <div key={x.label} className="rounded-2xl border border-[#e7eefe] bg-white p-4 flex gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(53,37,205,.08)', color: '#3525cd' }}>
                {x.icon}
              </div>
              <div>
                <p className="text-sm font-bold text-[#151c27] mb-0.5">{x.label}</p>
                <p className="text-xs text-[#464555] leading-relaxed">{x.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <Section id="authentication" title="1. Authentication & Access Control">
          <UL items={[
            <>Access to the Service requires authentication with a work email and password.</>,
            <>Passwords are stored as one-way hashes (bcrypt); we cannot view your plain-text password.</>,
            <>Organizations may optionally enable two-factor authentication (2FA / TOTP) for added account protection.</>,
            <>Sessions are issued as signed JSON Web Tokens with a limited lifetime.</>,
            <>Login and general API access are rate limited to reduce brute-force and scripted abuse.</>,
          ]} />
        </Section>

        <Section id="authorization" title="2. Authorization & Data Isolation">
          <Sub title="Role-based access control (RBAC)">
            <P>
              The platform enforces a role hierarchy (employee, HR admin, root admin) with a configurable permission matrix.
              Users only see and act on the modules their role and permissions allow.
            </P>
          </Sub>
          <Sub title="Organization / tenant isolation">
            <P>
              Each organization&rsquo;s data is separated and scoped by organization. Access checks are applied to data queries so that a user
              cannot read or modify another organization&rsquo;s records.
            </P>
          </Sub>
          <Sub title="Branch scoping">
            <P>
              Where an organization has multiple branches, administrators can be scoped to specific branches so their access is limited to
              the workforce they manage.
            </P>
          </Sub>
        </Section>

        <Section id="communication" title="3. Secure Communication & API">
          <UL items={[
            <>All traffic to the web and mobile applications is served over HTTPS.</>,
            <>API requests are authenticated with bearer tokens, and cross-origin requests are restricted to known origins.</>,
            <>Biometric device endpoints are protected by rate limiting and a device/IP allow-list, with access logged.</>,
          ]} />
        </Section>

        <Section id="data-protection" title="4. Data Protection">
          <UL items={[
            <>Core application data is stored in a PostgreSQL database with organization-level separation.</>,
            <>Uploaded files (documents and receipts) are stored with a third-party cloud storage provider over secure connections.</>,
            <>Email is delivered through a shared SMTP service; credentials are kept in server environment configuration, not in application code.</>,
          ]} />
        </Section>

        <Section id="monitoring" title="5. Monitoring, Logging & Security Updates">
          <UL items={[
            <>Server and request logs are used for security monitoring and troubleshooting.</>,
            <>Sensitive administrative actions (for example, biometric device activity and platform activity) are logged for audit.</>,
            <>We apply security fixes and platform updates on an ongoing basis.</>,
          ]} />
        </Section>

        <Section id="report" title="6. Report a Security Concern">
          <Callout tone="danger" title="Found a vulnerability?">
            <P>
              If you believe you have discovered a security issue or experienced an incident involving Lumos Logic HRMS, please report it to
              <a href="mailto:hello@lumoslogic.com" className="text-[#3525cd] font-semibold hover:underline"> hello@lumoslogic.com</a>.
            </P>
            <UL items={[
              <>Describe the issue in as much detail as you can.</>,
              <>Include steps to reproduce, where possible.</>,
              <>Do not include live passwords, API keys or other credentials.</>,
              <>Do not publicly disclose a suspected vulnerability before we have had a chance to respond.</>,
            ]} />
          </Callout>
        </Section>

        <Section id="more" title="7. Related Pages">
          <UL items={[
            <><Link to="/privacy-policy" className="text-[#3525cd] font-semibold hover:underline">Privacy Policy</Link> — how we handle personal information.</>,
            <><Link to="/contact" className="text-[#3525cd] font-semibold hover:underline">Contact &amp; Support</Link> — how to reach us.</>,
            <><Link to="/cookie-policy" className="text-[#3525cd] font-semibold hover:underline">Cookie Policy</Link> — cookies and similar technologies.</>,
          ]} />
        </Section>

        <Divider />
        <P className="text-sm text-[#777587] flex items-center gap-1.5">
          <AlertTriangle size={14} /> This page describes current practices and may be updated as the platform evolves.
        </P>
      </Prose>
    </LegalLayout>
  );
}
