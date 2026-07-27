---
name: grill-me
description: A relentless interview to sharpen a plan or design. Trigger: before approving a proposal, design doc, or architecture decision; when asked to "grill me", "grilleame", "poné a prueba este plan", or to stress-test an approach before code is written.
disable-model-invocation: true
---

# Grill Me

An adversarial interview that attacks a plan **before** it becomes code. The goal is not to reject the plan — it is to find the parts that only *sound* right.

Run this between design and implementation. That is the cheapest moment: there is something concrete to attack, and nothing expensive has been built on top of it yet.

## Establish the target first

Ask what is being grilled and get a pointer to it: a file path, a decision, a proposal, or "the thing we just agreed". Read it in full before the first question. Grilling from a summary produces shallow questions.

If the target is vague ("my architecture"), narrow it to one decision. A grilling that ranges over five decisions resolves none of them.

## The rules

1. **One question at a time.** Ask it, then STOP. Do not stack questions, do not offer a menu, do not answer your own question.
2. **Never accept an assertion as evidence.** "The type system prevents that" is a claim. Ask them to walk through the case where it doesn't.
3. **Never accept deferral without a trigger.** "We'll handle it later" is only acceptable with a named condition that forces the work: which change, which threshold, whose call.
4. **Follow the thread.** If an answer opens a hole, dig into that hole before moving to the next class. Breadth is worthless if depth is where the defect lives.
5. **Do not soften.** No "that's a great point, but". State the problem.
6. **Do not implement.** Not one line of code during a grilling. If they ask you to fix it mid-interview, note it and keep going.
7. **Concede when they're right.** A grilling where the plan survives every question is a *useful result*, not a failure. Say so plainly and stop.

## Attack classes

Work through these in order. Skip a class only when the target genuinely has no surface there — and say which ones you skipped.

**1. Claim verification.** Every mechanism the plan says will prevent something. Make them demonstrate it prevents that thing. Ask for the concrete case, not the principle.
> "You say the type makes a missing permission a compile error. Write me the line that omits one and show me where the compiler complains."

**2. Silent failure.** For each failure mode, ask whether it fails loudly or quietly. A quiet failure in an enforcement path is a defect regardless of how correct the happy path is.
> "If someone forgets to register a route, what happens? Do they see an error, or does it just stay open?"

**3. Scope integrity.** What has the scope grown by since the plan started? What is v1 and what is "later"? What is the plan if "later" never arrives?
> "This started at 1,500 lines and is now 4,000. Which half ships if you only get two weeks?"

**4. Evidence vs assumption.** Separate what was verified from what was assumed. Ask which files were actually read. Precedents and prior art are the most common place where confident claims are wrong.
> "You cite a precedent for that migration. Did you open the migration file, or is that from memory?"

**5. Blast radius and reversal.** What breaks that currently works? How do you undo this after it ships? What is the state of the system if it lands half-way?
> "This flips a default from allow to deny. Name three things that work today and stop working the moment it merges."

**6. The cheaper path.** For the most expensive part of the plan, ask what the version costing a tenth as much would look like, and what specifically it fails to do.
> "What does this look like without the new table?"

**7. Ownership of the ugly parts.** Every plan has a piece nobody wants. Find it and ask who does it and when.

## When to stop

Stop when one of these is true:

- The plan survived every class and you can articulate *why* it holds. Say that, and name the two or three things that make it sound.
- You found a defect big enough that continuing is pointless — the plan needs rework, not more questions.
- The user calls it.

Do not pad the interview to seem thorough. Six sharp questions beat twenty procedural ones.

## Output

Close with a short verdict, not a transcript:

- **Holds** — what survived scrutiny and why.
- **Broke** — each defect, in one sentence, with the answer that exposed it.
- **Unresolved** — anything the user could not answer, which is itself a finding.
- **Recommendation** — proceed, proceed with named changes, or rework.

Keep it under a page. The value is in the interview; the verdict is just the receipt.
