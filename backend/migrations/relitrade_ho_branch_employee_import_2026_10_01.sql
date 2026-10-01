-- ============================================================
-- relitrade_ho_branch_employee_import_2026_10_01.sql
--
-- Purpose:
--   Relitrade (org_id = 1) — request from client (Pranav Sir, 2026-10-01):
--     1. Rename branch "Main Area" (code MAIN, branch id 1) to "HO".
--     2. Insert the 53 employees from the client's employee master
--        export into the HO branch.
--     3. Register biometric PINs so back-dated September 2026 punches
--        from the Main Area device can be fetched/mapped for HO staff.
--
--   Safe to re-run:
--     • Branch rename is a no-op if already "HO".
--     • Employees are matched on employee_id OR device_enrollment_id
--       (org 1). Existing employees are NOT recreated.
--
--   IMPORTANT — existing employees:
--     By default (v_move_existing = FALSE) employees that already exist
--     on ANOTHER branch (Dalal / Bhuj / Gift City, etc.) are left where
--     they are, so Aug-2026 payroll/leave/attendance scoping is not
--     disturbed. They are listed in a NOTICE. Set v_move_existing := TRUE
--     below ONLY if the client really wants every listed person on HO.
--
--   Records NOT touched:
--     attendance, leaves, payslips, payroll runs, biometric_devices,
--     biometric_raw_logs, other branches.
--
--   Part 2 (end of file) also loads family members, nominees, driving
--   licence, height/weight, religion and emergency contact for NEW
--   employees only.
--
--   Not imported: shift assignment, weekly-off, qualification and
--   previous-employer / experience text.
--
-- HOW TO EXECUTE:
--   1. Run entire file in psql (psql -f ...).
--   2. Read the NOTICE output and the SELECTs at the end.
--   3. COMMIT; if correct, ROLLBACK; otherwise. No auto-commit.
--
-- Generated : 2026-10-01
-- Author    : Lumos Logic
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- STAGING: client export, one row per employee
-- ─────────────────────────────────────────────────────────────
CREATE TEMP TABLE _ho_stage (
  emp_id   TEXT, sal TEXT, name TEXT, dept TEXT, pos TEXT,
  doj      DATE, grade TEXT, phone TEXT, gender TEXT, dob DATE, blood TEXT,
  email    TEXT, marital TEXT,
  addr     TEXT, city TEXT, state TEXT, pin TEXT,
  pan      TEXT, aadhar TEXT, uan TEXT,
  bank     TEXT, bbranch TEXT, acct TEXT, ifsc TEXT, atype TEXT,
  pt BOOLEAN, ptrule TEXT, esi BOOLEAN, pf BOOLEAN,
  conf     DATE, probm INTEGER, sup TEXT, hod TEXT
) ON COMMIT DROP;

INSERT INTO _ho_stage VALUES
('401','Mr','Karan Kirtikumar Sanghvi','Management','MD','2012-12-03','A','9033607405','Male','1990-10-10','A+','karan@relitrade.in','Married','A 61, RIVIERA ELIGANS CORPORATE ROAD PRAHALADNAGAR','AHMEDABAD','GUJARAT','380015','CDAPS1491N','335176983267',NULL,'ICICI','Sindhubhavan','429601001158','ICIC0004296','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,NULL,NULL),
('403','Mrs','Sonal Karan Sanghvi','Management','Executive','2016-05-18','A','9099444493','Female','1989-05-29',NULL,'sanghvikaran@gmail.com',NULL,'A 61, RIVIERA ELIGANS CORPORATE ROAD PRAHALADNAGAR','AHMEDABAD','GUJARAT','380015',NULL,NULL,NULL,'ICICI BANK',NULL,'429601502274','ICIC0004296','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','401'),
('405','Mr','Pankaj Bhupendrabhai Khatri','KYC','Head','2015-06-10','B','9265942509','Male','1979-06-03','A+','khatripankaj454@gmail.com','Single','PANDIT DINDAYAL FLAT1, N 406 4TH FLOOR, OPP. SEEMA COLONY, VIVEKA NAND NAGAR, HATHIJAN, GERATPUR ROAD','AHMEDABAD','GUJARAT','382445','AQOPK1781E','357468376495',NULL,'Kotak Bank',NULL,'9447699846','KKBK0000958','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'618','401'),
('407','Ms','Nitika Sunil Patel','Backoffice','Executive','2016-04-01','A','9824455011','Female','1980-10-28',NULL,'nitikamayo@yahoo.co.in','Single','Surajbhavan Shreeji, Saurastra Patel society, Uttam Dairy Road, Rakhiyal','AHMEDABAD','GUJARAT','380023','BLUPP5308Q','361965637404',NULL,'Bank of Baroda',NULL,'84620100010440','BARB0DBBAPU','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','401'),
('408','Mr','Ranbir Jagdishbhai Chaudhary','RMS','Head','2017-05-02','A','9586817907','Male','1988-02-15','O-','ranbir1502@gmail.com','Married','A/26, GANDHI PARK SOCIETY, NR VIRATNAGAR, AHMEDABAD','AHMEDABAD','GUJARAT','382352','AKVPC9333K','617329241049',NULL,'Kotak Bank',NULL,'9346996435','KKBK0000958','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','401'),
('417','Mr','Dhaval Dineshbhai Thacker','Back Office and Operations','Executive','2011-12-25','A','9909893776','Male','1989-04-07',NULL,'dhavalthacker7210@gmail.com','Single','21, Ganesh chowk, Jeshtha Nagar, Bhuj City','BHUJ','GUJARAT','370001','BGGPT2728D','269780813199',NULL,'IDBI Bank',NULL,'411104000160841','IBKL0000411','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'438','401'),
('419','Ms','Avani Amitbhai Koradia','Backoffice','Executive','2011-12-25','A','9924455011','Female','1984-11-25',NULL,'arihant12000@hotmail.com','Married','A-302, Navrang Flat, Nr. Galaxy Cinema, Naroda, Ahmedabad','AHMEDABAD','GUJARAT','382330','AAWPP0138L','863852374082',NULL,'HDFC',NULL,'00061000226661','HDFC0000006','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','401'),
('420','Mr','Amrut Desai','Admin','Executive','2015-05-10','B','9714974064','Male','1986-10-24','A+','amartdesadi385@gmail.com','Married','463, rabari vas, new sharda mandir road sukhipura Ahmedabad City','AHMEDABAD','GUJARAT','380051','AOBPR9435D','220319342147',NULL,'ICICI BANK',NULL,'429601503750','ICIC0004296','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','605'),
('423','Mr','Pratap Ishwarlal Thakkar','Backoffice','Executive','2011-12-25','A','9925731000','Male','1961-07-14',NULL,'pankajruparel397@yahoo.com',NULL,'A-601, Retreat Tower, Opp Shyamal Row House-1, Nr Shyamal Char Rasta, 132 Ft Ring Road','AHMEDABAD','GUJARAT','380015','ABIPT1436C','649471310453',NULL,'HDFC',NULL,'251101001003000','HDFC0CGMCBL','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','401'),
('425','Ms','Krupa Bipinbhai Thakkar','Compliance','CS','2018-03-19','B','8320613013','Female','1995-10-16','A+','cskrupathakkar@gmail.com','Single','Vihardham Apartment, Nr Luv Kush Tower Thaltej','AHMEDABAD','GUJARAT','380015','BDIPT2182G','662257000957',NULL,'Kotak Bank',NULL,'9346996381','KKBK0000958','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','401'),
('431','Mr','Suresh Mangalbhai Gosai','Admin','Office Attendant','2016-02-18','B','7383421675','Male','1966-02-06','O+',NULL,'Married','Mangalpuri, 414-S F Patelni moti khadki, nr. Thaltej Post Office, Thaltej, Ahmedabad','AHMEDABAD','GUJARAT','380059','AKQPG5177L','601546045883',NULL,'Kotak Bank',NULL,'1347059430','KKBK0000958','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','605'),
('432','Mr','Suresh Kanjibhai Kumhar','Admin','Executive','2015-01-15','A','9998569960','Male','1983-04-03',NULL,NULL,'Married','221, Chamunda Nagar, Butbhavani Road, Vejalpur, Ahmedabad','AHMEDABAD','GUJARAT','380051',NULL,NULL,NULL,'Kotak Bank',NULL,'9346996442','KKBK0000958','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','605'),
('433','Mr','Keyur AnilKumar Kamdar','Trading','Dealer','2019-07-08','B','9408837146','Male','1981-07-02','AB+','keyur5309@gmail.com','Married','B101, PUSHPAK APARTMENT PRERNA TIRTH DERASAR ROAD SATELLITE','AHMEDABAD','GUJARAT','380015','AWMPK7085K','800023625790',NULL,'ICICI','Sindhubhavan','429601503736','ICIC0004296','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','408'),
('434','Mr','Nilesh Rameshbhai Parmar','Trading','Dealer','2019-07-01','B','8530567994','Male','1983-02-07','A+','nilesh.parmar1346@gmail.com','Married','B-703, Anand Elegence, V.I.P road, Opp Bharat Petrol Pump, Shela, South Bopal, Ahmedabad','AHMEDABAD','GUJARAT','380058','AQRPP7577J','631902691809',NULL,'Kotak Bank',NULL,'9148006714','KKBK0000958','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','408'),
('438','Mr','Ashok Sanghvi','Management','Founder','2014-12-25','A','9979755555','Male','1970-06-01',NULL,'ashok@relitrade.in',NULL,'Deep Bunglow, Ranchhod Wadi, Station Road, Bhuj','BHUJ','GUJARAT','370001','AGYPS1467M','732906043097',NULL,'ICICI BANK',NULL,'429605000441','ICIC0004296','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,NULL,NULL),
('440','Mr','Kirti Keshavlal Sanghvi','Management','Chief operations officer','2014-12-25','A','9913136000','Male','1962-03-14',NULL,'kirti@relitrade.in',NULL,'NA NA NA','AHMEDABAD','GUJARAT',NULL,'AGGPS5574S',NULL,NULL,'ICICI BANK',NULL,'429605000438','ICIC0004296','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','401'),
('441','Mr','Sunny Natvarlal Prajapati','RMS','Executive','2019-08-01','B','9979531293','Male','1986-12-08','AB-','sunnyprajapati1986@gmail.com','Single','C/38, ANSUYAPARK, PART-1, NARAYANNAGAR, NEAR KHODIYARNAGAR, BAPUNAGAR, AHMEDABAD','AHMEDABAD','GUJARAT','380024','BVBPP3723N','609685759909',NULL,'ICICI','Sindhubhavan','429601503745','ICIC0004296','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','408'),
('442','Mr','Dipen Maheshbhai Patel','Trading','Dealer','2019-08-01','B','9426422819','Male','1991-02-17','B+','dipenpatel549@yahoo.com','Single','Kakarkhad, Nr. Chora, Nadiad','NADIAD','GUJARAT','387002','BFRPP8057F','728547130658',NULL,'Kotak Bank',NULL,'3547873113','KKBK0000958','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','408'),
('448','Mr','Pranavkumar Rambhai Patel','IT','Head','2019-12-02','B','9537354565','Male','1989-09-03','O+','pranavbcpl@gmail.com','Married','C-501 Shanti Residency, Near Royal Circle Sargasan, Gandhinagar','GANDHINAGAR','GUJARAT','382421',NULL,'276787178834',NULL,'ICICI','Sindhubhavan','429601504031','ICIC0004296','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','401'),
('489','Mr','Jainam Hitenbhai Zota','Backoffice','Dealer','2022-04-01','B','8128600205','Male','2000-11-04',NULL,'jainamzota2000@gmail.com','Single','Omkar, Opp Vayda Dela, Talav Street, Dr.Mehta Marg, Bhuj-Kutch','BHUJ','GUJARAT','370001','ACPPZ3253R','247887514180',NULL,'SBI',NULL,'39504266529','SBIN0013011','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'438','401'),
('605','Ms','Isha Rajan Somani','Admin','Receptionist','2022-12-19','B','9106161446','Female','1995-06-23','B+','isha.shah2306@gmail.com','Married','B-34, Subhdarshan Apartment, Jodhpur Village, Prernatirth Derasar Road, Ahmedabad','AHMEDABAD','GUJARAT','380015','FOFPS7052G','859396754893',NULL,'Kotak Bank',NULL,'9346996459','KKBK0000958','savings',TRUE,'GUJARAT',FALSE,FALSE,'2023-04-03',NULL,'401','401'),
('611','Ms','Payal Dineshbhai Dabhi','Compliance','Executive','2023-04-15','B','9157547038','Female','1995-06-08','AB+','payal24165@gmail.com','Single','460/50 GAJANAND SOC GIRDHARNAGAR SHAHIBAUG AHMEDABAD','AHMEDABAD','GUJARAT','380004','CNKPD6614E','714034530236',NULL,'HDFC BANK','NAVRANGPURA','50100585348765','HDFC0000006','savings',TRUE,'GUJARAT',FALSE,FALSE,'2023-07-18',NULL,'618','401'),
('613','Ms','Madhuri Babulal Kariya','Accounts','Sr. Executive','2023-04-10','B','7575078549','Female','1991-12-10','B+','madhurikariya940@gmail.com','Single','202, KARMJYOT-3 NRAR VANDAN PARTY PLOT SATELLITE AHMEDABAD','AHMEDABAD','GUJARAT','380015','ECMPK7872Q','235302835913',NULL,'Kotak Bank','satellite ahmedabad','1347040490','KKBK0000810','savings',TRUE,'GUJARAT',FALSE,FALSE,'2023-07-18',NULL,'618','401'),
('615','Ms','Hina Nareshbhai Parmar','Accounts','Executive','2023-06-14','B','7490803817','Female','2000-11-17','O+','hinaparmar969@gmail.com','Single','B/116 SWASTIK BUNGLOWS RAIPURMILL COMPAUND RAKHIAL AHMEDABAD','AHMEDABAD','GUJARAT','380023','FGTPP0418K','495495297047',NULL,'BANK OF BARODA','SARASPUR AHMEDABAD','08580100021432','BARB0SARASP','savings',TRUE,'GUJARAT',FALSE,FALSE,'2023-10-04',NULL,'618','401'),
('618','Mr','Krunal Ashwinkumar Soni','Compliance','Head','2023-08-14','B','9998039285','Male','1986-04-17','A+','kunalsoni17@gmail.com','Married','D-501 Dharti Saket ICON, Behind Vardan Tower, Pragati Nagar Road, Naranpura, Ahmedabad-380013','AHMEDABAD','GUJARAT','380013','AYRPS9009E','847921143053',NULL,'Indian Bank','NARANPURA','776460704','IDIB000N013','savings',TRUE,'GUJARAT',FALSE,FALSE,'2023-10-31',NULL,'401','401'),
('628','Ms','Roshni Pareshbhai Rajput','DP','Sr. Executive','2023-10-10','B','9712804709','Female','1997-05-19',NULL,'roshnipr1997@gmail.com','Married','B 104 AASHRAY PLATINA NEAR SWAMINARAYN MANDIR NEW RANIP','AHMEDABAD','GUJARAT','382480',NULL,'884229652628',NULL,'HDFC BANK','AHMEDABAD VEJALPUR','50100405499297','HDFC0000048','savings',TRUE,'GUJARAT',FALSE,FALSE,'2024-01-15',NULL,'618','401'),
('635','Mr','Ajay Pravinji Devda','Admin','Office Boy','2023-12-05','B','9328348204','Male','1994-07-15','B+','ajaysinhdevda364@gmail.com','Married','M - 308 Dindayal pandit Vibhag -1, Hathijan, Ahmedabad','AHMEDABAD','GUJARAT','382445','EODPD1939A','863259053477',NULL,'Union Bank of India',NULL,'312802010051139','UBIN0531286','savings',TRUE,'GUJARAT',FALSE,FALSE,'2024-03-15',NULL,'401','605'),
('638','Ms','Zarna Mukeshbhai Suthar','Trading','Executive','2023-12-13','B','8160241565','Female','1991-06-07','B+','zarna7297@gmail.com','Married','B-405, Ganesh Icon & Heights, Dahegam Circle, S.P.Ring Road, New Naroda Ahmedabad','AHMEDABAD','GUJARAT','382330',NULL,'683716642221',NULL,'State Bank of India',NULL,'20343155808','SBIN0000498','savings',TRUE,'GUJARAT',TRUE,FALSE,'2024-03-15',NULL,'674','692'),
('653','Mr','Nitesh Jayendrabhai Patadiya','DP','Head','2024-06-03','B','9998336860','Male','1971-08-31','B+','niteshpatadiya@gmail.com','Married','C5 Navdeep flat, Bhimji Pura, Nava vadaj, Ahmedabad','AHMEDABAD','GUJARAT','380013',NULL,'833799623786',NULL,'ICICI BANK LTD','ASHRAM ROAD','018901549875','ICIC0000189','savings',TRUE,'GUJARAT',FALSE,FALSE,'2024-09-05',NULL,'618','401'),
('670','Ms','Anjali Sanjaykumar Parekh','Backoffice','Relationship Manager','2024-10-16','B','9173120109','Female','1999-06-09',NULL,'anjaliparekh05@gmail.com',NULL,'302, Ilax appartment, Near new Muktajivan English medium school Daxini, maninagar','AHMEDABAD','GUJARAT','380008',NULL,'293097979715',NULL,'Indian Bank','DAXINI SOCIETY, AHMEDABAD','6150895450','IDBIB000D042','savings',TRUE,'GUJARAT',FALSE,FALSE,'2025-01-23',NULL,'618','401'),
('673','Ms','Ishita Jamanbhai Dhokiya','Mutual Fund','Executive','2025-02-01','B','7487089481','Female','2003-05-28','B-','dhokiyaishita@gmail.com','Single','B-202, PELICAN HEIGHTS, B/H ANMOL ARISE, HATHIJAN CIRCLE, S P RING ROAD, Vinzol, Ahmedabad','AHMEDABAD','GUJARAT','382445','HDOPD0952C','649713487572',NULL,'BANK OF BARODA',NULL,'03700100048056','BARB0MITHAP','savings',TRUE,'GUJARAT',FALSE,FALSE,'2025-05-06',NULL,'401','501'),
('674','Mr','Jignesh Indulal Pandya','Research','Head of Research & Investments','2025-02-03','B','9870255051','Male','1982-12-17','B+','jignesh.pandya@relitrade.in','Married','Kudasan Gandhinagar','GANDHINAGAR','GUJARAT',NULL,'ATEPP0786D','850898830827',NULL,'HDFC',NULL,'02271140013786','HDFC0000227','savings',TRUE,'GUJARAT',FALSE,FALSE,'2025-05-06',NULL,'401','401'),
('677','Ms','Ishanee Piyushkumar Bhatt','Research','Executive','2025-05-15','B','8511569197','Female','2003-03-09','O+','ishaneebhatt9@gmail.com','Single','Plot No: 324/1, Sector: 4/B','GANDHINAGAR','GUJARAT','382006',NULL,'358204904285',NULL,'Axis Bank',NULL,'922010025297483','UTIB0001873','savings',TRUE,'GUJARAT',FALSE,FALSE,'2025-09-08',NULL,'401','674'),
('683','Ms','Kalpana Meena','Admin','Housekeeper','2025-07-01','B','9737673259','Female','2003-07-05',NULL,NULL,'Single','Lady Talav, Thaltej, Ahmedabad, Gujarat. Mukam Post, Pachlasa Chhota, PO: Pachlasa Chhota, Dungarpur','DUNGARPUR','RAJASTHAN','314038',NULL,'718717765098',NULL,NULL,NULL,NULL,NULL,NULL,FALSE,NULL,FALSE,FALSE,'2025-10-15',NULL,'401','605'),
('685','Mr','Lakhamir Vankabhai Rabari','Admin','Executive','2025-08-01','B',NULL,'Male','1987-06-01',NULL,NULL,NULL,'NR TO HANUMAN MANDIR NR BARANKRUPA STORE, SANOSARA, KUTCH','BHUJ','GUJARAT','370105','BPXPR1701N',NULL,NULL,'ICICI BANK',NULL,'008601551443','ICIC0000086','savings',TRUE,'GUJARAT',FALSE,FALSE,'2025-11-13',NULL,'438','401'),
('687','Ms','Bhumi Ashutosh Thakkar','Backoffice','Executive','2025-04-01','B','9978916200','Female','1993-11-17',NULL,NULL,NULL,'A/402, SHREEKUNJ APPT, B/H KANAK KALA, NR. SEEMA HALL, ANAND NAGAR RD, SATELITE','AHMEDABAD','GUJARAT','380015',NULL,'971640883005',NULL,'ICICI',NULL,'429601000680','ICIC0004296','savings',TRUE,'GUJARAT',FALSE,FALSE,'2025-11-13',NULL,'401','401'),
('692','Mr','Chirag Vishnubhai Patel','Delta','Business development manager','2025-12-15','B','9662429555','Male','1986-06-29','O+','chiragv29@gmail.com','Married','B-404 RHYTHM height nanachiloda Nr Megha height, new shahibagh ahmedabad','AHMEDABAD','GUJARAT','382330','AUMPP4325K','905089856711',NULL,'HDFC BANK',NULL,'12851050033427','HDFC0001285','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,NULL,'401','674'),
('693','Mr','Dixit Rameshbhai Gondaliya','Data','Analyst','2026-01-01','B',NULL,'Male','2002-07-30','B+',NULL,'Single',NULL,NULL,'GUJARAT',NULL,'CZQPG6045L','545260287515',NULL,'BANK OF BARODA','RING ROAD, GUJARAT','38760100014762','BARB0RINRAJ','savings',TRUE,'GUJARAT',FALSE,FALSE,'2026-04-24',NULL,'401','674'),
('694','Mr','Jaydip Kanubhai Patel','Trading','Dealer','2026-01-01','B','7575823272','Male','2001-04-16','O+','jaydippatel1642001@gmail.com','Married','H-503, Vishwash City 10, Gota Ahmedabad','AHMEDABAD','GUJARAT','382481','FQJPP6283G','831264941907','104006005527825','Union Bank of India','MADHI','292322010000108','UBIN0929239','savings',TRUE,'GUJARAT',FALSE,FALSE,'2026-05-13',NULL,'674','692'),
('698','Mr','Nikhil Yogesh Purohit','CS','Intern','2026-02-16','B','7297988727','Male','2003-05-17','O+','nikhilpurohit169@gmail.com','Single','Brahman Basti, Bajoli Dist- Nagaur','NAGAUR','RAJASTHAN','341503','GJWPP2238E','242321882285',NULL,'SBI','bajoli','40412777719','SBIN0031664','savings',FALSE,NULL,FALSE,FALSE,NULL,10,'401','425'),
('699','Mr','Jatin Deepakbhai Didwaniya','Accounts','Head','2026-03-02','B','9879327268','Male','2003-03-01','O+','didwaniyajatin007@gmail.com','Single','110/D, Lakhudi Co-op. Society, Sardar Patel Stadium road, Navrangpura, Ahmedabad','AHMEDABAD','GUJARAT','380009','HMPPD1126N','646742840979',NULL,'Bank of India','Vadaj Road','202810110014126','BKID0002028','savings',TRUE,'GUJARAT',FALSE,FALSE,'2026-06-23',NULL,'618','401'),
('802','Ms','Bhavna Shaileshbhai Parekh','Back Office','Backoffice and Operations','2026-04-16','B','7624033268','Female','1996-01-19',NULL,NULL,'Single','Siddharth Xclusive, Sargasan, Gandhinagar','GANDHINAGAR','GUJARAT',NULL,'FPFPP0410C','556563511300',NULL,'SBI',NULL,'32825623125','SBIN0060020','savings',FALSE,NULL,FALSE,FALSE,NULL,NULL,'401','674'),
('803','Ms','Riya Kishorbhai Dhacha','Accounts','Account executive','2026-06-08','B','9824275791','Female','2002-12-29',NULL,NULL,'Single','Plot No 799/1, Jagruti Park Society, Sector 30, Gandhinagar, Gujarat, 382030','GANDHINAGAR','GUJARAT','382030','HKXPD8627N','546452969956',NULL,'SBI','Sector 21, Gandhinagar','40055230679','SBIN0016685','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,3,'618','401'),
('804','Mr','Shyamal Mahendrabhai Bhatt','IT','Executive','2026-06-16','A','9624014981','Male','1981-09-14','A+',NULL,'Married','K 304 Sayona Green, Behind Vodafone, Gota, Daskroi, Ahmedabad, Gujarat, 382481','AHMEDABAD','GUJARAT','382481','ANOPB5210G','648617253636',NULL,'IDFC First Bank','ahmedabad gota','10152464964','IDFB0040337','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,3,'401','448'),
('805','Ms','Priyanshi Riteshbhai Sheth','Tele Sales','Relationship Manager','2026-06-15','B','9409032001','Female','2004-01-14',NULL,NULL,'Single','Navkar Elite 12, Motikunj Society, Opp audit Bhavan, Navrangpura, Ahmedabad','AHMEDABAD','GUJARAT','380009','QLWPS2013E','395172796235',NULL,'BANK OF BARODA','Vijaynagar, Bhuj','78160100039173','BARBOVJBHUJ','savings',FALSE,NULL,FALSE,FALSE,NULL,3,'401','401'),
('806','Mr','Bhavyakumar Sanjaykumar Bhavsar','Dealer','Dealer','2026-07-01','B','8487930325','Male','2003-02-27',NULL,NULL,'Single','Vihar, Gandhinagar, Gujarat, 382810','GANDHINAGAR','GUJARAT','382810','SLPPS7679M','215382823534',NULL,'BANK OF BARODA','KUKARWADA, MEHSANA, GUJARAT','01730100017270','BARB0KUKARW','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,3,'674','692'),
('807','Ms','Geetanjali Mehul Kothari','Compliance','Compliance Executive','2026-07-16','B','9967668455','Female','1997-03-06',NULL,NULL,'Single','03/H sattadhar co. op. society, nr hirabag part -1, ghatlodia, ahmedabad','AHMEDABAD','GUJARAT','380061','BCUPJ5072N','315335061762',NULL,'Axis Bank','Mira Road, Mumbai','915010045196986','UTIB0000573','current',TRUE,'GUJARAT',FALSE,FALSE,NULL,3,'618','401'),
('808','Ms','Riddhi Mukeshbhai Parmar','Dealer','Dealer','2026-08-03','B','8000927542','Female','2000-04-23',NULL,'riddhiparmar8000@gmail.com','Married','B/1003, PRAMUKH ARISTA NR. PRAMUKH GLORY SARGASAN GANDHINAGAR','GANDHINAGAR','GUJARAT','382421','FPSPP4348E','326166268582',NULL,'Axis Bank','Amreli','975827314','UTIB0000058','savings',TRUE,'GUJARAT',FALSE,FALSE,NULL,3,'674','692'),
('809','Mr','Vishal Atmarambhai Solanki','Admin','Office clerk','2026-08-01','B',NULL,'Male','1999-01-27',NULL,NULL,'Single',NULL,NULL,'GUJARAT',NULL,'IMYPS6008A','311865626157',NULL,'SBI','Dabhoda, Gandhinagar','32526631715','SBIN0002640','savings',TRUE,'GUJARAT',TRUE,TRUE,NULL,3,'401','605'),
('912','Mr','Birendra Kumal','Admin','Office Boy','2026-02-22','B','8451049300','Male','2007-05-03',NULL,'veerukumal909@gmail.com','Single','Lallubhai compound A - 56, Shri Ganesh Krupa Chawl, Annabhau sathe Nagar, Mankhurd West','MUMBAI','MAHARASHTRA',NULL,NULL,'930941634803',NULL,'Kotak Bank','Sion, Mumbai','2052405857','KKBK0000635','savings',FALSE,NULL,FALSE,FALSE,NULL,NULL,'401','401'),
('1909','Ms','Pallavi Kashiram Khanolkar','Dealing','Dealer','2022-05-10','B','9867297222','Female','1977-02-01','O+','pallavi_khanolkar@yahoo.com','Single','A/24, 3RD FLR, KRISHNAI NIWAS BLDG, KOPAR RD, DOMBIVLI(W), NEAR SANTOSHI MATA MANDIR','THANE','MAHARASHTRA','421202','ARXPK5434G','939810596687',NULL,'Kotak Bank','DOMBIVALI','3247673082','KKBK0000628','savings',TRUE,'MAHARASHTRA',FALSE,FALSE,NULL,NULL,'401','401'),
('1910','Mr','Ritesh Dhirajlal Gogri','Dealing','Dealer','2022-05-23','B','9004846434','Male','1983-10-07','O+','riteshgogri83@gmail.com','Single','H/304, BRIZA, ANCHOR PARK, EVERSHINE CITY LAST STOP, NEAR WATER TANK, VASAI EAST','VIRAR','MAHARASHTRA','401208','AJNPG8845K','790565608535',NULL,'Kotak Bank','VASAI MANIKPUR','3247673068','KKBK0000659','savings',TRUE,'MAHARASHTRA',FALSE,FALSE,NULL,NULL,'401','401'),
('1911','Ms','Jyotsna Ramesh Sane','Back Office','Executive','2022-06-01','B','8422089817','Female','2002-10-14','AB+','jyotsnasane71@gmail.com','Single','Mahatma Gandhi Nagar Rahivashi sangh M.G. Road Tata Power Lain Khali Opp Municipal School Dharavi Mumbai','MUMBAI','MAHARASHTRA','400017','NMPPS6177E','301807667379',NULL,'Kotak Bank','mumbai','3247673044','KKBK0000958','savings',TRUE,'MAHARASHTRA',FALSE,FALSE,NULL,NULL,'401','401');

CREATE TEMP TABLE _ho_new (user_id BIGINT, emp_id TEXT) ON COMMIT DROP;

DO $$
DECLARE
  v_org_id          BIGINT  := 1;
  v_move_existing   BOOLEAN := FALSE;   -- see header: TRUE = also move already-existing employees to HO
  v_ho_id           BIGINT;
  v_staged          INTEGER;
  v_existing        INTEGER;
  v_inserted        INTEGER;
  v_moved           INTEGER := 0;
  r                 RECORD;
BEGIN
  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'relitrade_ho_branch_employee_import_2026_10_01 — START';
  RAISE NOTICE '=======================================================';

  -- ───────────────────────────────────────────────────────────
  -- STEP 1: RENAME MAIN AREA → HO
  -- ───────────────────────────────────────────────────────────
  SELECT id INTO v_ho_id
  FROM branches
  WHERE org_id = v_org_id AND (code = 'MAIN' OR name IN ('HO','Main Area','Main Area (Ahmedabad)'))
  ORDER BY (code = 'MAIN') DESC, id
  LIMIT 1;

  IF v_ho_id IS NULL THEN
    RAISE EXCEPTION 'ABORT: Main Area / HO branch (code MAIN) not found for org_id=1.';
  END IF;

  UPDATE branches SET name = 'HO'
  WHERE id = v_ho_id AND org_id = v_org_id AND name <> 'HO';

  RAISE NOTICE 'STEP 1: HO branch id = % (renamed from Main Area if needed)', v_ho_id;

  -- ───────────────────────────────────────────────────────────
  -- STEP 2: WHO ALREADY EXISTS?
  -- ───────────────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_staged FROM _ho_stage;

  SELECT COUNT(*) INTO v_existing
  FROM _ho_stage s
  WHERE EXISTS (SELECT 1 FROM users u WHERE u.organization_id = v_org_id
                AND (u.employee_id = s.emp_id OR u.device_enrollment_id = s.emp_id));

  RAISE NOTICE 'STEP 2: % employees in client file; % already exist in DB; % new.',
               v_staged, v_existing, v_staged - v_existing;

  FOR r IN
    SELECT s.emp_id, s.name, COALESCE(b.name,'(no branch)') AS cur_branch, u.branch_id
    FROM _ho_stage s
    JOIN users u ON u.organization_id = v_org_id
                AND (u.employee_id = s.emp_id OR u.device_enrollment_id = s.emp_id)
    LEFT JOIN branches b ON b.id = u.branch_id
    WHERE u.branch_id IS DISTINCT FROM v_ho_id
    ORDER BY s.emp_id::INT
  LOOP
    RAISE NOTICE '  existing on other branch: % %  -> currently "%"%',
                 r.emp_id, r.name, r.cur_branch,
                 CASE WHEN v_move_existing THEN '  (will be MOVED to HO)' ELSE '  (left as is)' END;
  END LOOP;

  -- ───────────────────────────────────────────────────────────
  -- STEP 3: INSERT MISSING EMPLOYEES INTO HO
  -- ───────────────────────────────────────────────────────────
  WITH ins AS (
    INSERT INTO users (
      name, email, password, role, organization_id,
      employee_id, salutation, gender, date_of_birth, blood_group,
      department, position, grade, pay_cadre, salary_structure, salary_on,
      employment_type, employment_status, date_of_joining, joining_date, confirmation_date,
      phone, personal_email, marital_status, nationality,
      current_address_line1, current_city, current_state, current_country, current_postal_code,
      pan_number, aadhar_no, uan_no,
      bank_name, bank_account_number, bank_ifsc,
      probation_applicable, probation_months,
      pt_applicable, pt_rule, pf_applicable, esi_applicable,
      division, branch_id, device_enrollment_id,
      avatar_color, force_password_change
    )
    SELECT
      s.name,
      -- login email: personal email when it is free, else a unique placeholder
      CASE WHEN s.email IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM users x WHERE lower(x.email) = lower(s.email))
           THEN lower(s.email)
           ELSE 'emp' || s.emp_id || '@relitrade.in' END,
      '$2a$10$jmYpe0h87c.K1D5Kns9h.eKZfI6rzuPn8/b/4/M1n1VOmSViWQx6u',
      'employee', v_org_id,
      s.emp_id, s.sal, s.gender, s.dob, s.blood,
      s.dept, s.pos, s.grade, 'Staff', 'GROSS', 'Day',
      'full-time',
      CASE WHEN s.probm IS NOT NULL AND (s.doj + (s.probm || ' months')::interval) > DATE '2026-10-01'
           THEN 'probation' ELSE 'active' END,
      s.doj, s.doj, s.conf,
      s.phone,
      CASE WHEN s.email IS NOT NULL AND s.email NOT ILIKE '%@relitrade.in' THEN lower(s.email) END,
      s.marital, 'Indian',
      s.addr, s.city, s.state, 'INDIA', s.pin,
      s.pan, s.aadhar, s.uan,
      s.bank, s.acct, s.ifsc,
      (s.probm IS NOT NULL), s.probm,
      s.pt, s.ptrule, s.pf, s.esi,
      'Relitrade Stock Broking Private Limited', v_ho_id, s.emp_id,
      '#6366F1', TRUE
    FROM _ho_stage s
    WHERE NOT EXISTS (
      SELECT 1 FROM users u WHERE u.organization_id = v_org_id
        AND (u.employee_id = s.emp_id OR u.device_enrollment_id = s.emp_id)
    )
    RETURNING id, employee_id
  )
  INSERT INTO _ho_new SELECT id, employee_id FROM ins;

  SELECT COUNT(*) INTO v_inserted FROM _ho_new;
  RAISE NOTICE 'STEP 3: % new employees inserted into HO.', v_inserted;

  -- optional: move already-existing employees
  IF v_move_existing THEN
    UPDATE users u SET branch_id = v_ho_id
    FROM _ho_stage s
    WHERE u.organization_id = v_org_id
      AND (u.employee_id = s.emp_id OR u.device_enrollment_id = s.emp_id)
      AND u.branch_id IS DISTINCT FROM v_ho_id;
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    RAISE NOTICE 'STEP 3b: % existing employees moved to HO.', v_moved;
  END IF;

  -- ───────────────────────────────────────────────────────────
  -- STEP 4: REPORTING STRUCTURE (new employees only; never self)
  -- ───────────────────────────────────────────────────────────
  UPDATE users u SET
    reporting_to = (SELECT x.id FROM users x WHERE x.organization_id = v_org_id
                    AND x.employee_id = s.sup AND x.employee_id <> s.emp_id LIMIT 1),
    hod_id       = (SELECT x.id FROM users x WHERE x.organization_id = v_org_id
                    AND x.employee_id = s.hod AND x.employee_id <> s.emp_id LIMIT 1)
  FROM _ho_stage s
  JOIN _ho_new n ON n.emp_id = s.emp_id
  WHERE u.id = n.user_id;

  RAISE NOTICE 'STEP 4: reporting_to / hod_id set for new employees (unknown superiors left NULL).';

  -- ───────────────────────────────────────────────────────────
  -- STEP 5: BIOMETRIC PIN MAP (HO / Main Area device PINs = employee_id)
  --         Needed so back-dated Sep-2026 punches resolve to these users.
  -- ───────────────────────────────────────────────────────────
  INSERT INTO biometric_employee_map (org_id, employee_pin, user_id)
  SELECT v_org_id, u.device_enrollment_id, u.id
  FROM users u
  JOIN _ho_stage s ON s.emp_id = u.employee_id
  WHERE u.organization_id = v_org_id
    AND u.device_enrollment_id IS NOT NULL
  ON CONFLICT (org_id, employee_pin) DO NOTHING;

  RAISE NOTICE 'STEP 5: biometric_employee_map ensured for all client-file employees.';

  -- ───────────────────────────────────────────────────────────
  -- STEP 6: BANK ACCOUNTS (new employees only)
  -- ───────────────────────────────────────────────────────────
  INSERT INTO employee_bank_accounts
    (employee_id, organization_id, bank_name, branch_name, account_number, ifsc_code,
     account_type, payment_method, is_primary, is_salary_account)
  SELECT n.user_id, v_org_id, s.bank, s.bbranch, s.acct, s.ifsc,
         s.atype, 'bank_transfer', TRUE, TRUE
  FROM _ho_new n
  JOIN _ho_stage s ON s.emp_id = n.emp_id
  WHERE s.acct IS NOT NULL AND s.bank IS NOT NULL
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'STEP 6: bank accounts inserted for new employees.';

  -- ───────────────────────────────────────────────────────────
  -- STEP 7: POST-FLIGHT
  -- ───────────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = v_ho_id AND name = 'HO' AND org_id = v_org_id) THEN
    RAISE EXCEPTION 'ABORT: branch % is not named HO after rename.', v_ho_id;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'SUMMARY: HO id=% | file=% | pre-existing=% | inserted=% | moved=%',
               v_ho_id, v_staged, v_existing, v_inserted, v_moved;
  RAISE NOTICE 'Review the SELECTs below, then COMMIT; or ROLLBACK;';
END;
$$;

-- ────────────────────────────────────────────────────────────
-- PART 2: EXTRA PROFILE DATA (from the client CSV, exact columns)
--   Applied to NEWLY INSERTED employees only (_ho_new) — existing
--   employees' profiles are never overwritten.
--   Covers: religion, height/weight, emergency contact, driving licence,
--           family members, nominees.
--   Skipped (unreliable / no target): weekly-off, shift, qualification,
--           experience, Aadhaar-name, wife/"nominee" entries that are
--           clearly data-entry mistakes (425, 807).
-- ────────────────────────────────────────────────────────────

CREATE TEMP TABLE _ho_x (
  emp_id TEXT, religion TEXT, height TEXT, weight TEXT,
  dl_no TEXT, dl_exp DATE, em_phone TEXT, em_name TEXT, em_rel TEXT
) ON COMMIT DROP;

INSERT INTO _ho_x VALUES
('401','Jain','5.11',NULL,NULL,NULL,NULL,NULL,NULL),
('405','Hindu','5','45','Gj01183650104','2024-05-10','9265942509',NULL,NULL),
('408','Hindu','5.9','75',NULL,NULL,NULL,NULL,NULL),
('420','Hindu',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('425','Hindu',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('431',NULL,NULL,NULL,NULL,NULL,'9998306481',NULL,NULL),
('433','Hindu',NULL,'63.6',NULL,NULL,'8238418866',NULL,NULL),
('434','Hindu','152','62',NULL,NULL,'9426439665',NULL,NULL),
('441','Hindu','5.6','55','GJ2720200008524','2030-03-18','8401236497',NULL,NULL),
('442','Hindu',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('448','Hindu','5.11','68',NULL,NULL,'9427069793',NULL,NULL),
('605','Hindu',NULL,NULL,NULL,NULL,'9904123431',NULL,NULL),
('611',NULL,NULL,NULL,NULL,NULL,'7227906091',NULL,NULL),
('613',NULL,'5.3','75',NULL,NULL,'9904788600',NULL,NULL),
('615',NULL,'5','46',NULL,NULL,NULL,NULL,NULL),
('618',NULL,NULL,NULL,NULL,NULL,'9998896389',NULL,NULL),
('628',NULL,'5.3','50',NULL,NULL,'9904818838',NULL,NULL),
('673','Hindu','5.1','55',NULL,NULL,'7874435530',NULL,NULL),
('674','Hindu','5.1','75',NULL,NULL,NULL,NULL,NULL),
('677','Hindu','152','40',NULL,NULL,NULL,NULL,NULL),
('692','Hindu','5.4','75.5',NULL,NULL,'9375132186',NULL,NULL),
('693','Hindu','5.67','75',NULL,NULL,NULL,NULL,NULL),
('694','Hindu',NULL,'70','GJ0220210021766','2041-04-15','9712053014','Jignesh Kanubhai Patel','Brother'),
('698','Hindu','6.3','70',NULL,NULL,'9413507523','Raminaw Pareek','Grand Father'),
('699','Hindu','5.7','58','GJ01 20210045648','2043-02-28','9824227268','Deepakbhai Didwaniya','Father'),
('638',NULL,'5.04','73',NULL,NULL,NULL,NULL,NULL),
('683','Hindu',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('802','Hindu',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('803','Hindu',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('804','Hindu','5','65',NULL,NULL,NULL,NULL,NULL),
('805','Hindu',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('806','Hindu',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('807','Hindu',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('808','Hindu',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('809','Hindu',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('1909','Hindu','5.5','63',NULL,NULL,'8879816553',NULL,NULL),
('1910','Jain','5.4','100','MH02 20140038059','2033-10-06','9987789807',NULL,NULL),
('1911','Hindu','5.5','45',NULL,NULL,'9702871788',NULL,NULL);

-- family: emp_id, relationship, name, dob, occupation, dependent
CREATE TEMP TABLE _ho_fam (
  emp_id TEXT, rel TEXT, name TEXT, dob DATE, occ TEXT, dep BOOLEAN
) ON COMMIT DROP;

INSERT INTO _ho_fam VALUES
('401','father','Kirtikumar','1962-03-14','Business',FALSE),
('401','mother','Sadhanaben','1965-09-15','Housewife',FALSE),
('401','spouse','Sonal','1989-05-29',NULL,FALSE),
('401','child','Freya','2020-04-14',NULL,TRUE),
('405','father','Bhupendra Khatri','1950-06-03','Service',FALSE),
('405','mother','Meenaben Khatri','1955-09-10','House wife',FALSE),
('408','father','Jagdish Chaudhary',NULL,NULL,FALSE),
('408','mother','Radhaben Chaudahry',NULL,NULL,FALSE),
('408','spouse','Renu Chaudhary',NULL,NULL,FALSE),
('408','child','Divyaan',NULL,NULL,TRUE),
('408','child','Kriva',NULL,NULL,TRUE),
('417','father','Dineshbhai Thacker',NULL,NULL,FALSE),
('419','spouse','Amit Koradia',NULL,NULL,FALSE),
('420','father','Sayji Bhai Desai',NULL,NULL,FALSE),
('420','mother','Samuben Desai',NULL,NULL,FALSE),
('420','spouse','Ashaben Desai',NULL,NULL,FALSE),
('425','father','Bipinbhai Thakkar','1964-07-25',NULL,FALSE),
('425','mother','Bhartiben Thakkar','1967-12-18',NULL,FALSE),
('431','father','Mangalpuri Gosai',NULL,NULL,FALSE),
('431','mother','Leelaben Gosai',NULL,NULL,FALSE),
('431','spouse','Darshnaben Gosai',NULL,NULL,FALSE),
('431','child','Tirth Gosai','2009-08-26',NULL,TRUE),
('432','father','Kanji Kumar',NULL,NULL,FALSE),
('432','mother','Amrat Kumar',NULL,NULL,FALSE),
('432','spouse','Sumitra Kumar',NULL,NULL,FALSE),
('433','father','Anilkumar','1954-09-27','Gov. Retired',FALSE),
('433','mother','Ranjanben','1950-02-09',NULL,FALSE),
('433','spouse','Bansi Kamdar','1992-08-23',NULL,FALSE),
('433','child','Keshil Kamdar','2009-03-05',NULL,TRUE),
('433','child','Lavya Kamdar','2020-05-20',NULL,TRUE),
('434','father','Rameshbhai M Paramr',NULL,'Retire',FALSE),
('434','mother','Jyotiben R Parmar','1962-08-13','Expired',FALSE),
('441','father','Prajapati Natvarlal','1947-11-14','Retire',FALSE),
('441','mother','Prajapati Kusumben','1959-12-16','Housewife',FALSE),
('442','father','Maheshbhai Patel',NULL,NULL,FALSE),
('448','father','Rambhai Patel','1948-12-01','Farming',FALSE),
('448','mother','Gomtiben Patel','1948-01-01','House wife',FALSE),
('448','spouse','Harshida Patel','1986-11-21',NULL,FALSE),
('448','child','Divya Patel','2015-02-21',NULL,TRUE),
('448','child','Shlok Patel','2017-05-20',NULL,TRUE),
('489','father','Hitenbhai Zota',NULL,NULL,FALSE),
('605','father','Pradip Shah','1961-05-25','Business',FALSE),
('605','mother','Varsha Shah','1971-10-07','House wife',FALSE),
('605','spouse','Rajan Somani','1995-11-21',NULL,FALSE),
('611','father','Dineshbhai Dabhi',NULL,NULL,FALSE),
('611','mother','Veenaben',NULL,NULL,FALSE),
('613','father','Babulal Kariya',NULL,NULL,FALSE),
('613','mother','Jashodaben Kariya',NULL,NULL,FALSE),
('615','father','Nareshbhai',NULL,'Employee',FALSE),
('615','mother','Kokilaben','1970-06-28','Housewife',FALSE),
('628','father','Pareshbhai Rajput',NULL,NULL,FALSE),
('635','father','Pravinji Devda',NULL,NULL,FALSE),
('635','mother','Maheta Ben Devda',NULL,NULL,FALSE),
('635','spouse','Aartiba Devda',NULL,NULL,FALSE),
('638','father','Dilipbhai',NULL,NULL,FALSE),
('638','mother','Meenaben',NULL,NULL,FALSE),
('638','spouse','Mukesh Suthar','1988-09-22',NULL,FALSE),
('638','child','Viya','2017-07-19',NULL,TRUE),
('638','child','Hayan','2022-09-22',NULL,TRUE),
('674','father','Indulal Pandya',NULL,NULL,FALSE),
('674','mother','Meena Pandya',NULL,NULL,FALSE),
('674','spouse','Pooja Pandya',NULL,NULL,FALSE),
('677','father','Piyushkumar Bhatt','1965-09-26','Government job',FALSE),
('677','mother','Parulben Bhatt','1970-01-27','House wife',FALSE),
('683','father','Keshavlal Meena',NULL,NULL,FALSE),
('683','mother','Kesardevi Meena',NULL,NULL,FALSE),
('692','father','Vishnubhai','1959-05-10',NULL,FALSE),
('692','mother','Bharatiben','1966-06-01',NULL,FALSE),
('692','spouse','Anita','1989-12-15',NULL,FALSE),
('694','father','Patel Kanubhai Revabhai','1971-11-16','Farmer & Businessmen',FALSE),
('694','mother','Patel Surekhaben Kanubhai','1975-06-01','Home Maker',FALSE),
('694','spouse','Patel Nikitaben Jaydip','2001-11-17',NULL,FALSE),
('698','father','Yogesh',NULL,NULL,FALSE),
('698','mother','Sushila','1983-09-01',NULL,FALSE),
('699','father','Deepakbhai Didwaniya','1974-05-20','Business',FALSE),
('699','mother','Ashaben Didwaniya','1980-06-12','House Wife',FALSE),
('802','father','Shaileshbhai',NULL,NULL,FALSE),
('803','father','Kishorbhai Dhacha',NULL,NULL,FALSE),
('804','father','Mahendrabhai Bhatt',NULL,NULL,FALSE),
('804','mother','Jyoti Mahendra Bhatt','1947-02-28','Ret. Teacher',FALSE),
('804','spouse','Arti Shyamal Bhatt','1985-02-25',NULL,FALSE),
('804','child','Atharv Shyamal Bhatt','2018-12-20',NULL,TRUE),
('805','father','Riteshbhai Sheth',NULL,NULL,FALSE),
('806','father','Sanjaykumar Bhavsar',NULL,NULL,FALSE),
('807','father','Paras Jain',NULL,NULL,FALSE),
('808','father','Mukeshbhai Parmar',NULL,NULL,FALSE),
('808','spouse','Raj Kakrecha',NULL,NULL,FALSE),
('809','father','Atmarambhai Solanki',NULL,NULL,FALSE),
('1909','father','Kashiram',NULL,NULL,FALSE),
('1909','mother','Vidya',NULL,'Housewife',FALSE),
('1910','father','Dhirajlal Gogri','1948-06-20','Business',FALSE),
('1910','mother','Manjula Gogri','1954-07-18','House Wife',FALSE),
('1911','father','Ramesh Baliram Sane',NULL,'Paper printing',FALSE),
('1911','mother','Roshani Ramesh Sane',NULL,'House wife',FALSE);

-- nominees: emp_id, name, relationship
CREATE TEMP TABLE _ho_nom (emp_id TEXT, name TEXT, rel TEXT) ON COMMIT DROP;
INSERT INTO _ho_nom VALUES
('405','Meena Ben','Mother'),
('431','Tirth Gosai','Son'),
('433','Keshil Kamdar','Son'),
('605','Rajan Somani','Husband'),
('611','Veenaben Dabhi','Mother'),
('615','Nareshbhai Parmar','Father'),
('653','Sunita Patadiya','Spouse'),
('674','Pooja Pandya','Wife'),
('677','Tvisha Bhatt','Sister'),
('692','Anita Patel','Wife'),
('694','Patel Jigneshkumar','Brother'),
('699','Deepakbhai Didwaniya','Father'),
('804','Arti Shyamal Bhatt','Wife'),
('1909','Sudhir Desai','Brother'),
('1911','Roshani Sane','Mother');

DO $$
DECLARE
  v_org_id BIGINT := 1;
  n_x INT; n_f INT; n_n INT; n_d INT;
BEGIN
  -- profile columns on users (NULL / 0 values are left untouched)
  UPDATE users u SET
    religion                   = COALESCE(x.religion, u.religion),
    height                     = COALESCE(NULLIF(x.height,'0'), u.height),
    weight                     = COALESCE(NULLIF(x.weight,'0'), u.weight),
    emergency_contact_phone    = COALESCE(x.em_phone, u.emergency_contact_phone),
    emergency_contact_name     = COALESCE(x.em_name,  u.emergency_contact_name),
    emergency_contact_relation = COALESCE(x.em_rel,   u.emergency_contact_relation)
  FROM _ho_x x JOIN _ho_new n ON n.emp_id = x.emp_id
  WHERE u.id = n.user_id;
  GET DIAGNOSTICS n_x = ROW_COUNT;

  -- family members
  INSERT INTO employee_family_members
    (employee_id, organization_id, relationship, name, date_of_birth, occupation, dependent)
  SELECT n.user_id, v_org_id, f.rel, f.name, f.dob, f.occ, f.dep
  FROM _ho_fam f JOIN _ho_new n ON n.emp_id = f.emp_id;
  GET DIAGNOSTICS n_f = ROW_COUNT;

  -- nominees (single nominee = 100% share, primary)
  INSERT INTO employee_nominees
    (employee_id, organization_id, nominee_name, relationship, percentage_share, is_primary)
  SELECT n.user_id, v_org_id, m.name, m.rel, 100, TRUE
  FROM _ho_nom m JOIN _ho_new n ON n.emp_id = m.emp_id;
  GET DIAGNOSTICS n_n = ROW_COUNT;

  -- driving licences
  INSERT INTO employee_government_documents
    (employee_id, organization_id, document_type, document_number, expiry_date)
  SELECT n.user_id, v_org_id, 'driving_license', x.dl_no, x.dl_exp
  FROM _ho_x x JOIN _ho_new n ON n.emp_id = x.emp_id
  WHERE x.dl_no IS NOT NULL
  ON CONFLICT (employee_id, document_type, organization_id) DO NOTHING;
  GET DIAGNOSTICS n_d = ROW_COUNT;

  RAISE NOTICE 'PART 2: users updated=% | family rows=% | nominees=% | driving licences=%',
               n_x, n_f, n_n, n_d;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- REVIEW QUERIES (run inside the open transaction)
-- ────────────────────────────────────────────────────────────

-- 1. Branch master
SELECT id, name, code, location, is_active FROM branches WHERE org_id = 1 ORDER BY id;

-- 2. Client-file employees and the branch they are now on
SELECT u.employee_id, u.name, u.department, u.position, u.employment_status,
       b.name AS branch, u.device_enrollment_id AS bio_pin
FROM   users u
LEFT   JOIN branches b ON b.id = u.branch_id
WHERE  u.organization_id = 1
  AND  u.employee_id IN (SELECT emp_id FROM _ho_stage)
ORDER  BY u.employee_id::INT;

-- 3. Client-file employees with NO biometric map row (should be 0 rows)
SELECT u.employee_id, u.name
FROM   users u
WHERE  u.organization_id = 1
  AND  u.employee_id IN (SELECT emp_id FROM _ho_stage)
  AND  NOT EXISTS (SELECT 1 FROM biometric_employee_map m WHERE m.org_id = 1 AND m.user_id = u.id);

-- 4. Main Area device(s) — confirm they point at HO
SELECT id, serial_number, device_name, branch_id, status, last_seen
FROM   biometric_devices WHERE org_id = 1 AND branch_id = (SELECT id FROM branches WHERE org_id = 1 AND code = 'MAIN');

-- COMMIT;   -- when satisfied
-- ROLLBACK; -- to cancel
