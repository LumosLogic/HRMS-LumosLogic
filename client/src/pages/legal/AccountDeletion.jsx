import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import LegalLayout from '@/components/layout/LegalLayout';
import { useAuth } from '@/context/AuthContext';
import { apiPost } from '@/lib/api';
import { PageHero, Prose, Section, Sub, P, UL, OL, Callout, Divider } from '@/components/legal/LegalKit';

const LAST_UPDATED = 'October 3, 2026';

function DeletionForm() {
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('idle'); // idle | submitting | success | error
  const [message, setMessage] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus('submitting');
    try {
      const res = await apiPost('/auth/request-deletion', { reason: reason.trim() });
      setStatus('success');
      setMessage(res.message || 'Your deletion request has been submitted to your HR team.');
      setReason('');
    } catch (err) {
      setStatus('error');
      setMessage(err.message || 'Unable to submit the request. Please contact support.');
    }
  }

  if (status === 'success') {
    return (
      <Callout tone="success" title="Request submitted">
        <P>{message}</P>
        <P>Your organization&rsquo;s HR administrators have been notified and will review your request.</P>
      </Callout>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-[#e7eefe] bg-white p-5 md:p-6 my-6">
      <p className="text-sm font-bold text-[#151c27] mb-1">Request Account / Data Deletion</p>
      <p className="text-sm text-[#777587] mb-4">
        Submits a request to your organization&rsquo;s HR administrators. Provide an optional reason to help them process it.
      </p>
      <label className="form-label" htmlFor="deletion-reason">Reason (optional)</label>
      <textarea
        id="deletion-reason"
        className="form-control mb-4 min-h-[96px]"
        placeholder="Why are you requesting deletion? (optional)"
        value={reason}
        onChange={e => setReason(e.target.value)}
        maxLength={1000}
      />
      {status === 'error' && (
        <p className="text-sm text-rose-600 font-semibold mb-3">{message}</p>
      )}
      <button type="submit" disabled={status === 'submitting'} className="btn btn-primary btn-lg btn-full">
        {status === 'submitting' ? 'Submitting…' : 'Request Account / Data Deletion'}
      </button>
    </form>
  );
}

export default function AccountDeletion() {
  const { token } = useAuth();

  return (
    <LegalLayout
      title="Lumos Logic HRMS Account & Data Deletion"
      description="How to request account and data deletion from Lumos Logic HRMS, including organization-controlled accounts and legal retention."
      path="/account-deletion"
    >
      <PageHero
        eyebrow="Support"
        title="Account & Data Deletion"
        subtitle="How to request deletion of your Lumos Logic HRMS account and associated data."
        meta={[`Last Updated: ${LAST_UPDATED}`]}
      />

      <Prose>
        <P>
          This page explains how to request deletion of your account and associated data from Lumos Logic HRMS, what happens after
          a request, and which information may need to be retained for legal or regulatory reasons.
        </P>

        <Callout tone="info" title="Employee accounts are organization-controlled">
          <P>
            In most cases your Lumos Logic HRMS account is created and managed by your employer. Your employee records (attendance, leave,
            payroll, documents and so on) are part of your organization&rsquo;s HR records. For this reason, deletion requests are routed to
            your organization&rsquo;s HR administrators, who review and process them in line with their own policies and applicable law.
          </P>
        </Callout>

        <Section id="how-to-request" title="1. How to Request Deletion">
          <Sub title="If you are signed in">
            <P>
              The quickest way is to submit a request directly from this page while signed in to your account — it will be sent to your
              organization&rsquo;s HR administrators automatically. You may also contact your HR team or our support address below.
            </P>
            {token ? <DeletionForm /> : (
              <Callout tone="warning" title="Sign in to submit a request">
                <P>
                  You are not currently signed in. To submit a deletion request directly from your account, please
                  <Link to="/login" className="text-[#3525cd] font-semibold hover:underline"> sign in</Link> and return to this page.
                  Alternatively, email <a href="mailto:hello@lumoslogic.com" className="text-[#3525cd] font-semibold hover:underline">hello@lumoslogic.com</a>.
                </P>
              </Callout>
            )}
          </Sub>
          <Sub title="If you cannot sign in">
            <P>
              Email <a href="mailto:hello@lumoslogic.com" className="text-[#3525cd] font-semibold hover:underline">hello@lumoslogic.com</a> from
              the email address associated with your account. Include enough information to identify the account (for example, your name, work
              email and organization name). We will route the request to the appropriate organization.
            </P>
          </Sub>
        </Section>

        <Section id="what-may-be-deleted" title="2. What May Be Deleted">
          <P>Subject to review and applicable retention requirements, the following may be deleted or anonymized:</P>
          <UL items={[
            <>Your account credentials and profile information.</>,
            <>Personal information you provided (contact details, documents, profile fields).</>,
            <>Attendance, leave, expense and performance records attributable to you (subject to retention, below).</>,
            <>Push notification subscriptions and device tokens associated with your account.</>,
          ]} />
        </Section>

        <Section id="what-may-be-retained" title="3. What May Be Retained">
          <P>Some information may need to be retained even after a deletion request, including:</P>
          <UL items={[
            <><strong>Payroll and statutory records</strong> — where required by tax, labour or other laws for a mandatory retention period.</>,
            <><strong>Records required for legal or audit purposes</strong> — such as records subject to litigation, investigations or regulatory obligations.</>,
            <><strong>Security and access logs</strong> — retained for security, fraud prevention and troubleshooting for a limited period.</>,
            <><strong>Anonymized or aggregated data</strong> — that no longer identifies you.</>,
          ]} />
          <P>
            Your organization may also retain copies of records in its own systems outside Lumos Logic HRMS; those are outside our control.
          </P>
        </Section>

        <Section id="after-request" title="4. What Happens After a Request">
          <OL items={[
            <>Your request is received and routed to the appropriate organization (or reviewed by Lumos Logic for accounts it directly manages).</>,
            <>The reviewer verifies the request and confirms it relates to the correct account.</>,
            <>Eligible data is deleted or anonymized; data subject to legal retention is retained only as required.</>,
            <>You are informed of the outcome, or you may contact us for a status update.</>,
          ]} />
          <P>
            Processing times depend on the organization and applicable requirements. Requests submitted from your signed-in account are
            acknowledged by your HR team&rsquo;s notification.
          </P>
        </Section>

        <Section id="contact" title="5. Contact Support">
          <P>
            For help with a deletion request, contact
            <a href="mailto:hello@lumoslogic.com" className="text-[#3525cd] font-semibold hover:underline"> hello@lumoslogic.com</a> or use our
            <Link to="/contact" className="text-[#3525cd] font-semibold hover:underline"> Contact &amp; Support</Link> page.
          </P>
        </Section>

        <Divider />
        <P className="text-sm text-[#777587]">
          Lumos Logic HRMS is a product of Lumos Logic. Deletion of organization-controlled records is subject to the organization&rsquo;s
          policies and applicable law.
        </P>
      </Prose>
    </LegalLayout>
  );
}
