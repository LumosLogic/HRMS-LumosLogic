import React from 'react';
import { Link } from 'react-router-dom';
import LegalLayout from '@/components/layout/LegalLayout';
import { PageHero, Prose, Section, Sub, P, UL, Callout, Divider } from '@/components/legal/LegalKit';

const LAST_UPDATED = 'October 3, 2026';

export default function TermsOfService() {
  return (
    <LegalLayout
      title="Lumos Logic HRMS Terms of Service"
      description="Terms of Service for Lumos Logic HRMS — the terms governing use of the HRMS platform by organizations, administrators and employees."
      path="/terms-of-service"
    >
      <PageHero
        eyebrow="Legal"
        title="Terms of Service"
        subtitle="The terms that govern access to and use of Lumos Logic HRMS."
        meta={[`Last Updated: ${LAST_UPDATED}`]}
      />

      <Prose>
        <P>
          These Terms of Service (&ldquo;Terms&rdquo;) are a legal agreement between you and <strong>Lumos Logic</strong> (&ldquo;Lumos Logic&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo; or &ldquo;our&rdquo;) governing your access to and use of <strong>Lumos Logic HRMS</strong> (the &ldquo;Service&rdquo;),
          including any related websites and mobile applications. By accessing or using the Service, you agree to be bound by these Terms.
        </P>

        <Section id="acceptance" title="1. Acceptance of Terms">
          <P>
            By creating an account, or by accessing or using the Service, you confirm that you have read, understood and agree to these Terms.
            If you are using the Service on behalf of an organization, you represent that you have authority to bind that organization to these
            Terms. If you do not agree, do not use the Service.
          </P>
        </Section>

        <Section id="description" title="2. Description of the Service">
          <P>
            Lumos Logic HRMS is a multi-tenant human resource management platform that provides features such as employee management,
            attendance tracking, leave management, payroll, documents, expenses, performance tracking, onboarding and exit management.
            Lumos Logic provides the Service; each organization configures and manages its own workspace and employee data.
          </P>
        </Section>

        <Section id="roles" title="3. The Three Parties Involved">
          <P>To avoid confusion, these Terms distinguish three roles:</P>
          <UL items={[
            <><strong>Lumos Logic</strong> — the provider of the HRMS platform and infrastructure.</>,
            <><strong>Organization Administrator</strong> — an HR admin or root admin who manages the organization&rsquo;s workspace, employees, settings and data.</>,
            <><strong>Employee / End User</strong> — an individual who uses the Service through their organization&rsquo;s account.</>,
          ]} />
        </Section>

        <Section id="accounts" title="4. Accounts &amp; Account Security">
          <UL items={[
            <>You must provide accurate and complete information when creating or maintaining an account.</>,
            <>You are responsible for keeping your login credentials confidential and for all activity that occurs under your account.</>,
            <>Notify your administrator or us promptly of any unauthorized use of your account.</>,
            <>We may suspend or terminate accounts that violate these Terms or applicable law.</>,
          ]} />
        </Section>

        <Section id="admin-responsibilities" title="5. Organization Administrator Responsibilities">
          <P>Organization administrators are responsible for:</P>
          <UL items={[
            <>Configuring the workspace, roles, permissions and workflows accurately.</>,
            <>Maintaining the accuracy of employee records they enter.</>,
            <>Complying with applicable employment, data protection and other laws in how they use employee data.</>,
            <>Managing employee access, including deactivating accounts when an employee leaves the organization.</>,
            <>Obtaining any necessary notices or consents from employees regarding the processing of their personal information.</>,
          ]} />
        </Section>

        <Section id="employee-responsibilities" title="6. Employee / User Responsibilities">
          <P>Employees and end users are responsible for:</P>
          <UL items={[
            <>Using the Service in accordance with these Terms and their organization&rsquo;s policies.</>,
            <>Submitting accurate information (for example, accurate leave requests and attendance corrections).</>,
            <>Not sharing login credentials or accessing data they are not authorized to view.</>,
          ]} />
        </Section>

        <Section id="acceptable-use" title="7. Acceptable Use">
          <P>You agree not to:</P>
          <UL items={[
            <>Use the Service in violation of any applicable law or regulation.</>,
            <>Attempt to gain unauthorized access to other users&rsquo; accounts or data, or to the underlying systems.</>,
            <>Interfere with or disrupt the integrity or performance of the Service.</>,
            <>Upload content that is unlawful, defamatory, or that infringes the rights of others.</>,
            <>Reverse engineer, decompile or otherwise attempt to extract the source code of the Service, except as permitted by law.</>,
            <>Use automated means (bots or scrapers) to access or extract data without authorization.</>,
          ]} />
        </Section>

        <Section id="organization-data" title="8. Organization-Controlled Employee Data">
          <P>
            Employee data in the Service is controlled by the organization that owns the workspace. The organization&rsquo;s administrators
            determine who may access that data and how it is used within the Service. Lumos Logic acts as a service provider with respect to
            that data. Disputes regarding employee data should be raised with the relevant organization first.
          </P>
        </Section>

        <Section id="intellectual-property" title="9. Intellectual Property">
          <P>
            The Service, including its software, design, branding and documentation, is owned by Lumos Logic or its licensors and is protected
            by intellectual property laws. You retain ownership of the content and data you or your organization upload to the Service. Subject
            to these Terms, you grant Lumos Logic a limited license to host, store and process that content solely to provide the Service.
          </P>
        </Section>

        <Section id="availability" title="10. Service Availability">
          <P>
            We aim to keep the Service available and reliable, but we do not guarantee uninterrupted or error-free operation. The Service may
            be temporarily unavailable for maintenance, updates or events beyond our control. We may modify, suspend or discontinue features
            from time to time.
          </P>
        </Section>

        <Section id="third-party" title="11. Third-Party Services &amp; Integrations">
          <P>
            The Service may integrate with third-party services (such as email delivery, cloud file storage, calendar synchronization and
            biometric devices). Your use of those third-party services may be subject to their own terms and policies. Lumos Logic is not
            responsible for the practices or availability of third-party services.
          </P>
        </Section>

        <Section id="user-content" title="12. User-Generated &amp; Uploaded Content">
          <P>
            You are solely responsible for content you upload or submit through the Service, including documents, receipts and messages.
            You represent that you have the right to provide such content. We may remove content that violates these Terms or applicable law.
          </P>
        </Section>

        <Section id="termination" title="13. Suspension &amp; Termination">
          <P>
            We may suspend or terminate access to the Service for a breach of these Terms, for security reasons, or where required by law.
            Organizations may deactivate employee accounts through their administrators. On termination, your right to access the Service ends,
            subject to any data retention described in our Privacy Policy.
          </P>
        </Section>

        <Section id="data-handling" title="14. Data Handling">
          <P>
            Our handling of personal information is described in our
            <Link to="/privacy-policy" className="text-[#3525cd] font-semibold hover:underline"> Privacy Policy</Link>. Account deletion
            requests are handled as described in our
            <Link to="/account-deletion" className="text-[#3525cd] font-semibold hover:underline"> Account &amp; Data Deletion</Link> page.
          </P>
        </Section>

        <Section id="liability" title="15. Limitation of Liability">
          <P>
            To the maximum extent permitted by law, Lumos Logic and its suppliers shall not be liable for any indirect, incidental, special,
            consequential or punitive damages, or for any loss of profits, revenue, data or goodwill, arising out of or related to your use of
            the Service. To the maximum extent permitted by law, Lumos Logic&rsquo;s total aggregate liability arising out of or related to these
            Terms or the Service shall not exceed the amount paid by your organization to Lumos Logic for the Service in the twelve months
            preceding the event giving rise to the claim, or one hundred U.S. dollars if no fees were paid.
          </P>
          <Callout tone="info" title="&ldquo;As-is&rdquo; basis">
            <P>
              Except as expressly set out in these Terms, the Service is provided on an &ldquo;as-is&rdquo; and &ldquo;as-available&rdquo; basis without
              warranties of any kind, whether express or implied.
            </P>
          </Callout>
        </Section>

        <Section id="changes" title="16. Changes to the Service &amp; These Terms">
          <P>
            We may update these Terms from time to time. When we make material changes, we will revise the &ldquo;Last Updated&rdquo; date at the top
            of this page and, where appropriate, notify you through the Service. Your continued use of the Service after changes take effect
            constitutes acceptance of the updated Terms.
          </P>
        </Section>

        <Section id="contact" title="17. Contact Information">
          <P>
            Questions about these Terms may be directed to
            <a href="mailto:hello@lumoslogic.com" className="text-[#3525cd] font-semibold hover:underline"> hello@lumoslogic.com</a> or
            via our <Link to="/contact" className="text-[#3525cd] font-semibold hover:underline">Contact &amp; Support</Link> page.
          </P>
        </Section>

        <Divider />
        <P className="text-sm text-[#777587]">
          Lumos Logic HRMS is a product of Lumos Logic.
        </P>
      </Prose>
    </LegalLayout>
  );
}
