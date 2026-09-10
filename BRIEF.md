# Utopia — Programmer Assessment (brief verbatim)

Source: https://docs.google.com/document/d/1Onc1Jy21k8UjEP8JKosmV7ytWDYoH1oWH9VcQolPPpI/edit
Window: **Start 9/9/2026 (Wed) 11:00AM → End 12/9/2026 (Sat) 11:00AM** (72 hours)

---

Programmer Assessment – Operations System + AI Challenge
🔖 Company Overview
Company: Sejuk Sejuk Service Sdn Bhd (fictional name)
Sejuk Sejuk Service provides air-conditioner installation, servicing and repair for homes and businesses.
Operational context:
* 5 branches nationwide
* 40+ technician teams operating in the field
* Admin staff mainly work on desktop systems
* Technicians primarily use mobile devices in the field
Business Goal
Digitise the full service workflow:
Order → Assignment → Service Completion → Manager / Accounts Review
This assessment simulates a simplified internal operations system used by the company.
________________


✍️ What’s This Assessment About?
We want to understand how you:
* Build real-world business workflows
* Think in systems and data models, not just pages
* Design clean and practical interfaces
* Integrate AI capabilities into business tools
* Explain your technical decisions clearly
You may complete one or more modules.
We care more about how you think and design the system than the number of modules completed.
________________


🛠 Suggested Tech Stack
Candidates may use any stack they prefer.
However, our preferred stack is:
Layer
	Preferred Tools
	Front-end
	React
	Styling
	Tailwind CSS
	Backend / Database
	Supabase
	File Storage
	Supabase Storage
	Deployment
	Vercel
	Login
	Simple mock login / role switch
	

Authentication
Real authentication is not required.
A simple mock login or role selector is sufficient.
Example roles:
* Admin
* Technician
* Manager
You may implement a simple role switch to simulate different users.
Bonus if you implement basic authentication.
________________


🤖 AI Integration
For AI-related modules, candidates may use:
Layer
	Preferred Tools
	AI API
	OpenAI / Claude / Gemini / equivalent
	Backend AI logic
	Node.js / Serverless function
	Data retrieval
	Supabase queries / backend functions
	The AI assistant should answer questions based on system data retrieved through controlled queries.
It should not rely on unrestricted access to the entire database. 
AI responses should be based on structured data retrieved from the system.
________________


🧭 Simplified System Workflow
Admin creates an order
     ↓
Technician receives job
     ↓
Technician completes service
     ↓
System sends notification
     ↓
Manager reviews job
     ↓
Dashboard updates performance metrics
________________


⚙️ Basic System Rules
Orders follow a simplified workflow state:
New → Assigned → In Progress → Job Done → Reviewed → Closed
Example rules:
* Only Admin can assign technicians
* Only the assigned technician can mark a job as completed
* Managers may review completed jobs
* Key actions should be traceable
You do not need to fully enforce these rules but your system should consider them in design.
________________


📦 Module 1 — Admin Portal · Order Submission
Goal: Admin creates a service order and assigns a technician
Section
	Details
	Form fields
	Order No (auto-generated)
Customer Name
Phone
Address
Problem Description
Service Type (dropdown)
Quoted Price
Assigned Technician
Admin Notes
	Key skills
	Front-end: responsive form, clean UI
Back-end: auto-generated ID + write to database
	Bonus
	* Show order summary after submission
* Send WhatsApp notification to technician
	________________


🧰 Module 2 — Technician Portal · Service Job
Goal: Technicians view assigned jobs and record completed service.
Important Note
The technician workflow should prioritize speed and simplicity for field usage.
Technicians should be able to complete the job quickly using a mobile device.
Candidates may implement this as:
* a mobile-first web interface
* or a mobile app
Section
	Details
	Form fields
	Order ID (read-only)
Work Done
Extra Charges
Upload ≤ 6 photos / video / PDF
Final Amount (auto-calculated)
Remarks
Technician Name
Timestamp


Optional Bonus:
Technician may record payment received from customer


Example fields:
Payment Amount
Payment Method
Receipt Photo
	Key skills
	Front-end: mobile-friendly UI, simple field workflow
Back-end: file upload, writing service completion data
	Bonus
	* Generate WhatsApp feedback message send to customer
* Notify manager/accounts when job completed
	Sample Data (JSON)
{
  "orderId": "ORDER1234",
  "customerName": "Ahmad",
  "address": "No. 12, Jalan Sejuk, Shah Alam",
  "service": "Aircond cleaning",
  "assignedTechnician": "Ali",
  "status": "Pending"
}


Mock technicians: Ali, John, Bala, Yusoff
________________


📣 Module 3 — WhatsApp Notification Trigger
Goal: Send WhatsApp notification when a job is marked Job Done.
* Trigger Condition: status = Job Done

* Notification Methods: WhatsApp (preferred) — e.g. a deep-link URL with a pre-filled message
Sample message
Hi {{Customer Name}}, 
Job {{Order ID}} has been completed by Technician {{Name}} at {{Time}}.
Please check and leave feedback. 
Thank you!
Key skill: back-end trigger logic + API / deep-link integration
________________


📊 Bonus Module — KPI Dashboard
Goal: Display technician performance metrics.
Section
	Details
	Example Metrics
	Technician
Jobs Completed
Total Amount
Postpone / Reschedule
	UI Suggestions
	Card layout
Leaderboard
Simple charts
	Assessment Focus
	data aggregation
clear visualisation
	You may implement metrics using weekly data (minimum).
Bonus if additional views are included.
________________


🤖 AI Module — Operations Query Window
Goal: Build a simple AI assistant inside the portal that allows managers to ask operational questions about service data.
Example questions:
   * What jobs did technician Ali complete last week?
   * Which technician completed the most jobs this week?
   * How many jobs were completed today?
________________


Expected System Flow
User question
     ↓
System interprets question/query
     ↓
Database retrieves relevant data
     ↓
AI formats the response


Example output:
Technician Ali completed 3 jobs last week:
ORDER1234 – Cleaning
ORDER1237 – Repair
ORDER1241 – Gas refill
________________


Assessment Focus
We want to see:
   * how AI integrates with system data
   * how queries retrieve relevant records
   * how responses are generated clearly
   * how limitations are handled
________________


⭐ Optional Advanced AI Challenges
Candidates may optionally implement one or more of these.
________________


AI Workflow Supervisor
Use AI to flag potential issues in completed jobs.
Example alerts:
Final amount much higher than quoted price
Job done but no photos uploaded
________________


AI Document Understanding
Use AI to extract structured data from uploaded documents.
Example extracted fields:
Customer name
Service type
Service details
Amount
Date
________________


AI Operational Insight
Use AI to analyze operational data.
Example question:
Which technician might be overloaded this week?
Example output:
Technician Bala completed 11 jobs this week, which is significantly higher than the team average.
________________


💬 Optional Self-Assessment (README)
Candidates may include:
   * Which module was easiest?
   * Which module was hardest?
   * What would you improve in a real production system?
   * How did you use AI tools while building this project?
________________


📬 Submission Guide
   1. Live demo (Netlify / Vercel / Firebase) or ZIP

   2. GitHub repo (preferred)

   3. README explaining:

      * What you built
      * Tech stack used
      * Architecture decisions
      * Challenges / assumptions
      * How AI was integrated
      * What limitations exist in your implementation?
Also describe:
What types of AI queries are supported
Limitations of your AI implementation
If you only did one module, explain your logic clearly — it helps us see your strengths.
________________


🎨 Design & Branding
No logo required.
Focus on:
      * clean UI
      * simple UX
      * practical design
Treat this like a real-world internal operations tool.
________________


Estimated Effort
Candidates are not expected to complete everything.
A solid implementation of one or two modules with clear explanation is sufficient.
A well-explained partial implementation is acceptable.
________________
