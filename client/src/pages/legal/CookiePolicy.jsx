import React from 'react';
import { Link } from 'react-router-dom';
import { Cookie, ShieldCheck, Ban, BarChart2 } from 'lucide-react';
import LegalLayout from '@/components/layout/LegalLayout';
import { PageHero, Prose, Section, Sub, P, UL, Callout, Divider } from '@/components/legal/LegalKit';

const LAST_UPDATED = 'October 3, 2026';

export default function CookiePolicy() {
  return (
    <LegalLayout
      title="Lumos Logic HRMS Cookie Policy"
      description="Cookie Policy for Lumos Logic HRMS — how cookies and similar technologies are (or are not) used on the platform."
      path="/cookie-policy"
    >
      <PageHero
        eyebrow="Legal"
        title="Cookie Policy"
        subtitle="How Lumos Logic HRMS uses cookies and similar technologies."
        meta={[`Last Updated: ${LAST_UPDATED}`]}
      />

      <Prose>
        <P>
          This Cookie Policy explains how Lumos Logic HRMS (&ldquo;we&rdquo;, &ldquo;us&rdquo; or &ldquo;our&rdquo;) uses cookies and similar
          technologies. It applies to the Lumos Logic HRMS website and web application.
        </P>

        <Callout tone="info" title="The short version">
          <P>
            Lumos Logic HRMS does not use advertising cookies and does not run third-party analytics or cross-site tracking. The platform
            primarily relies on tokens stored in your browser&rsquo;s local storage for authentication rather than cookies. Any cookies that are
            used are strictly essential for security and basic functionality.
          </P>
        </Callout>

        <Section id="what-are-cookies" title="1. What Are Cookies?">
          <P>
            Cookies are small text files stored on your device by a website. They are commonly used to remember preferences, keep you signed
            in, or understand how a website is used. Similar technologies include browser local storage, which can store small amounts of data
            such as an authentication token.
          </P>
        </Section>

        <Section id="how-we-use" title="2. How We Use Cookies & Similar Technologies">
          <Sub title="Essential cookies / local storage">
            <UL items={[
              <>Authentication tokens used to keep you signed in are stored in your browser&rsquo;s local storage, not in cookies.</>,
              <>Where set, any session or security cookies are strictly necessary for the secure functioning of the application (for example, protecting against cross-site request forgery).</>,
            ]} />
          </Sub>
          <Sub title="Preference cookies">
            <P>
              We may use local storage to remember non-sensitive preferences (such as a selected branch or UI state) to improve your experience.
              These are stored on your device and are not used for advertising.
            </P>
          </Sub>
          <Sub title="Analytics & advertising cookies">
            <P>
              <strong>We do not use analytics, advertising or third-party tracking cookies.</strong> Lumos Logic HRMS does not run advertising
              networks and does not use cookies to track you across other websites.
            </P>
          </Sub>
        </Section>

        <div className="grid sm:grid-cols-3 gap-4 my-8">
          {[
            { icon: <ShieldCheck size={20} />, title: 'Essential', desc: 'Security & sign-in only.' },
            { icon: <BarChart2 size={20} />, title: 'Analytics', desc: 'Not used.' },
            { icon: <Ban size={20} />, title: 'Advertising', desc: 'Not used.' },
          ].map(x => (
            <div key={x.title} className="rounded-2xl border border-[#e7eefe] bg-white p-4 text-center">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2.5"
                style={{ background: 'rgba(53,37,205,.08)', color: '#3525cd' }}>
                {x.icon}
              </div>
              <p className="text-sm font-bold text-[#151c27]">{x.title}</p>
              <p className="text-xs text-[#777587]">{x.desc}</p>
            </div>
          ))}
        </div>

        <Section id="managing" title="3. Managing Cookies & Storage">
          <P>
            Most browsers allow you to view, block or delete cookies and site data (including local storage). You can also clear your browser&rsquo;s
            local storage to remove any stored authentication token and preferences. Note that blocking essential functionality may prevent the
            application from working correctly (for example, you may be signed out).
          </P>
        </Section>

        <Section id="third-party" title="4. Third-Party Services">
          <P>
            The platform uses a limited set of third-party services (such as cloud storage for uploaded files and an email delivery service).
            These services may set their own cookies where you interact with their hosted content. We do not use them to serve advertising or
            track you across the web.
          </P>
        </Section>

        <Section id="changes" title="5. Changes to This Policy">
          <P>
            We may update this Cookie Policy from time to time. Changes will be posted on this page with an updated &ldquo;Last Updated&rdquo; date.
          </P>
        </Section>

        <Section id="contact" title="6. Contact">
          <P>
            Questions about this Cookie Policy? Contact us at
            <a href="mailto:hello@lumoslogic.com" className="text-[#3525cd] font-semibold hover:underline"> hello@lumoslogic.com</a>. For details on
            how we handle personal information, see our
            <Link to="/privacy-policy" className="text-[#3525cd] font-semibold hover:underline"> Privacy Policy</Link>.
          </P>
        </Section>

        <Divider />
        <P className="text-sm text-[#777587] flex items-center gap-1.5">
          <Cookie size={14} /> Lumos Logic HRMS is a product of Lumos Logic.
        </P>
      </Prose>
    </LegalLayout>
  );
}
