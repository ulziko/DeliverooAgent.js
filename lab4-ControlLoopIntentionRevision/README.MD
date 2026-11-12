---
marp: true
theme: default
paginate: true
style: |
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
  :root {
    --color-primary: #00C853;
    --color-secondary: #6C63FF;
    --color-accent: #FF6D00;
  }
  section {
    font-family: 'Inter', sans-serif;
  }
  h1 {
    color: var(--color-primary);
  }
  h2 {
    color: var(--color-secondary);
  }
  strong {
    color: var(--color-accent);
  }
  code {
    background: #f4f4f4;
    padding: 2px 6px;
    border-radius: 4px;
  }
  pre {
    background: #e8f3ff;
    color: #2c2c2c;
    padding: 15px;
    border-radius: 8px;
  }
  section.small {
    font-size: 22px;
  }
  section.small pre {
    font-size: 18px;
    padding: 10px;
  }
  section.small li {
    line-height: 1.25;
    margin: 0;
  }
backgroundImage: url('https://marp.app/assets/hero-background.svg')
header: 'Control Loop and Intention Revision · [DeliverooAgent.js](https://github.com/unitn-ASA/DeliverooAgent.js) · [Deliveroo.js](https://github.com/unitn-ASA/Deliveroo.js)'
footer: 'Marco Robol - University of Trento, A.Y. 2026/2027 - Autonomous Software Agents'
---

<!-- _class: lead -->

# Control Loop and Intention Revision

Implementing the BDI control loop for the Deliveroo.js environment

Code: [https://github.com/unitn-ASA/DeliverooAgent.js](https://github.com/unitn-ASA/DeliverooAgent.js)
Deliveroo.js: [https://github.com/unitn-ASA/Deliveroo.js](https://github.com/unitn-ASA/Deliveroo.js)

---

<style scoped>
section { font-size: 24px; }
li { line-height: 1.25; margin: 0; }
p { margin: 0.4em 0; }
</style>

## The assignment

Implement a BDI control loop so that:

- **options** are generated from beliefs; after filtering, one is selected and the agent has the **intention** to achieve it
- a plan from the **plan library** is used to achieve it
    - non applicable plans are skipped
    - when an applicable plan is found, it is executed
    - if the plan fails, the next one is tried
    - when no plan is left (all failed), the intention fails
- alternative reasoning could be considered, e.g. insist by looping over the plans
- **sub-intentions**: a plan can rely on other plans
- plans can be **stopped** at any time from the outside

---

## From reactive to BDI

In Lab 3 the agent re-selected the nearest parcel after **every step**: no commitment, possible oscillation.

A **BDI** agent separates the concerns:

| Layer | In `intention_revision.js` |
|---|---|
| **Beliefs** | `me`, `parcels` updated by `onSensing` |
| **Desires / options** | `optionsGeneration()` → `['go_pick_up', x, y, id]` |
| **Intentions** | `IntentionRevision` queue of `IntentionDeliberation` |
| **Plans** | `planLibrary`: `GoPickUp`, `BlindMove` |

Files: `intention_revision.js` (the agent), `multiple_run.js` (spawns 5 agents)

---

<!-- _class: small -->

## Beliefs – `me` and `parcels`

```javascript
socket.onSensing( ( { self } ) => {
    if ( ! self ) return;
    const {id, name, x, y, score} = self;
    me.id = id; me.name = name; me.score = score;
    if ( x != undefined ) me.x = x;
    if ( y != undefined ) me.y = y;
} )

socket.onSensing( async ( sensing ) => {
    // add or update perceived parcels
    for (const p of sensing.parcels) parcels.set( p.id, p);
    // forget parcels that are no longer perceived
    const perceived_ids = new Set( sensing.parcels.map( p => p.id ) );
    for ( const id of parcels.keys() )
        if ( ! perceived_ids.has( id ) ) parcels.delete( id );
} )
```

- Parcels are indexed by `id`; parcels out of view are **forgotten** (no memory, as in Lab 3)
- Compare with Lab 2: what would change if parcels out of view were remembered?

---

<!-- _class: small -->

## Options generation and filtering

```javascript
function optionsGeneration () {
    // Options generation
    const options = []
    for (const parcel of parcels.values())
        if ( ! parcel.carriedBy )
            options.push( [ 'go_pick_up', parcel.x, parcel.y, parcel.id ] );

    // Options filtering: keep the nearest one
    let best_option;
    let nearest = Number.MAX_VALUE;
    for (const option of options) {
        let [go_pick_up, x, y, id] = option;
        let current_d = distance( {x, y}, me )
        if ( current_d < nearest ) { best_option = option; nearest = current_d }
    }

    // Best option is selected and pushed to the intention revision
    if ( best_option ) myAgent.push( best_option )
}

socket.onSensing( optionsGeneration )
```

---

<!-- _class: small -->

## Options – Explanation

- An option (desire) is a **predicate**: an array `['go_pick_up', x, y, id]`
- **Generation**: one option per free parcel (`! parcel.carriedBy`)
- **Filtering**: only the nearest one survives, a simple **utility** function
- **Selection**: `myAgent.push(...)` hands it over to intention revision, which decides **whether and when** to commit to it
- Options are regenerated at **every sensing event**
  - alternative (commented in the code): a `while(true)` loop calling `optionsGeneration()`
  - TODO: regenerate only when beliefs actually change (e.g. a new parcel is observed)

---

## Intention revision – The loop

```javascript
async loop ( ) {
    while ( true ) {
        if ( this.intention_queue.length > 0 ) {
            const intention = this.intention_queue[0];

            // Is queued intention still valid? Do I still want to achieve it?
            let id = intention.predicate[2]
            let p = parcels.get(id)
            if ( p && p.carriedBy ) {
                console.log( 'Skipping intention because no more valid', intention.predicate )
            }
            else {
                await intention.achieve().catch( error => { } );
            }

            // Remove from the queue
            this.intention_queue.shift();
        }
        // Postpone next iteration at setImmediate
        await new Promise( res => setImmediate( res ) );
    }
}
```

---

## Intention revision – Explanation

- The **head** of `intention_queue` is the current intention
- Before committing, the intention is **re-validated** against current beliefs
  - here hard-coded: a parcel already carried by someone is not worth chasing
  - an invalid intention is skipped by **removing** it from the queue: a bare `continue` would retry it forever, blocking the event loop
- `achieve()` failures (all plans failed, or stopped) are **caught**: the agent drops the intention and moves on
- `await setImmediate` yields to the event loop at every iteration, so `onSensing` callbacks can update beliefs and push new options

---

<!-- _class: small -->

## Intention revision strategies

`IntentionRevision` is abstract: subclasses implement **`push(predicate)`**, deciding what to do with a newly selected option.

```javascript
// const myAgent = new IntentionRevisionQueue();
const myAgent = new IntentionRevisionReplace();
// const myAgent = new IntentionRevisionRevise();
myAgent.loop();
```

- **Queue** – the option is queued for achievement after the current ones
- **Replace** – the current intention is immediately terminated and replaced by the new one
- **Revise** – *to be done* – options are re-sorted with a utility function; the current plan may be (i) continued, (ii) terminated and forgotten, (iii) terminated but kept in the queue

---

<!-- _class: small -->

## `IntentionRevisionQueue`

```javascript
async push ( predicate ) {
    // Check if already queued
    if ( this.intention_queue.find( (i) => i.predicate.join(' ') == predicate.join(' ') ) )
        return; // intention is already queued

    const intention = new IntentionDeliberation( this, predicate );
    this.intention_queue.push( intention );
}
```

- Duplicates are detected by comparing predicates as strings
- Intentions are achieved **in order of arrival**, regardless of how good they are
- Drawback: the queue can grow with parcels that, by the time they are reached, are far away, expired or taken by others

---

<!-- _class: small -->

## `IntentionRevisionReplace`

```javascript
async push ( predicate ) {
    // Check if already being achieved
    const last = this.intention_queue.at( this.intention_queue.length - 1 );
    if ( last && last.predicate.join(' ') == predicate.join(' ') ) {
        return;
    }

    const intention = new IntentionDeliberation( this, predicate );
    this.intention_queue.push( intention );

    // Force current intention stop
    if ( last ) {
        last.stop();
    }
}
```

- The same option pushed again does **not** interrupt the current intention: **commitment**
- A **different** option stops the current one; the loop catches the failure, shifts it out and starts the new one

---

<!-- _class: small -->

## `IntentionRevisionRevise` – Your turn

```javascript
async push ( predicate ) {
    console.log( 'Revising intention queue. Received', ...predicate );
    // TODO
    // - order intentions based on utility function (reward - cost)
    //   (for example, parcel score minus distance)
    // - eventually stop current one
    // - evaluate validity of intention
}
```

- Overall reward depends also on the **order** in which intentions are executed
- Consider: when is it worth **interrupting** a plan in progress?
- How do you avoid **oscillating** between two similar options?

---

<!-- _class: small -->

## `IntentionDeliberation` – Achieving with the plan library

```javascript
async achieve () {
    if ( this.#started ) return false;   // Cannot start twice
    this.#started = true;

    for (const planClass of planLibrary) {
        if ( this.stopped ) throw [ 'stopped intention', ...this.predicate ];

        if ( planClass.isApplicableTo( ...this.predicate ) ) {
            this.#current_plan = new planClass(this.#parent);
            try {
                const plan_res = await this.#current_plan.execute( ...this.predicate );
                return plan_res || false;
            } catch (error) {
                this.log( 'failed intention', ...this.predicate, 'with plan', planClass.name );
            }
        }
    }

    if ( this.stopped ) throw [ 'stopped intention', ...this.predicate ];
    throw ['no plan satisfied the intention ', ...this.predicate ]
}
```

---

<!-- _class: small -->

## `IntentionDeliberation` – Explanation

- Plans are tried **in library order**
  - `isApplicableTo` is a **static** check on the predicate (the plan's trigger/context)
  - an applicable plan is **instantiated** and executed
  - on failure (exception) the **next** applicable plan is tried
  - success **returns**, all plans failing **throws**
- `stop()` sets a flag and stops the current plan: the intention throws at the next check
- Alternative reasoning: instead of failing after one round, **insist** by looping over the plans again (until stopped or a timeout)

---

<!-- _class: small -->

## Plans – `PlanBase`

```javascript
class PlanBase {
    #stopped = false;
    stop () {
        this.#stopped = true;
        for ( const i of this.#sub_intentions ) i.stop();
    }
    get stopped () { return this.#stopped; }

    #sub_intentions = [];
    async subIntention ( predicate ) {
        const sub_intention = new IntentionDeliberation( this, predicate );
        this.#sub_intentions.push( sub_intention );
        return sub_intention.achieve();
    }
}
```

- A plan can post **sub-intentions**, achieved again with the plan library
- `stop()` **propagates down**: intention → plan → sub-intentions → their plans
- `#parent` links intentions and plans so that `log()` **indents** nested output

---

<!-- _class: small -->

## Plans – `GoPickUp`

```javascript
class GoPickUp extends PlanBase {

    static isApplicableTo ( go_pick_up, x, y, id ) {
        return go_pick_up == 'go_pick_up';
    }

    async execute ( go_pick_up, x, y ) {
        if ( this.stopped ) throw ['stopped'];
        await this.subIntention( ['go_to', x, y] );
        if ( this.stopped ) throw ['stopped'];
        await socket.emitPickup()
        if ( this.stopped ) throw ['stopped'];
        return true;
    }
}
```

- A **composite** plan: reach the tile through the `go_to` sub-intention, then pick up
- JavaScript cannot interrupt a pending `await`: plans check `this.stopped` **between actions**, which are the points where they can be stopped

---

<!-- _class: small -->

## Plans – `BlindMove`

```javascript
async execute ( go_to, x, y ) {
    while ( me.x != x || me.y != y ) {
        if ( this.stopped ) throw ['stopped'];

        let moved_horizontally, moved_vertically;
        if ( x > me.x )      moved_horizontally = await socket.emitMove('right')
        else if ( x < me.x ) moved_horizontally = await socket.emitMove('left')
        if ( moved_horizontally ) { me.x = moved_horizontally.x; me.y = moved_horizontally.y; }

        if ( this.stopped ) throw ['stopped'];

        if ( y > me.y )      moved_vertically = await socket.emitMove('up')
        else if ( y < me.y ) moved_vertically = await socket.emitMove('down')
        if ( moved_vertically ) { me.x = moved_vertically.x; me.y = moved_vertically.y; }

        if ( ! moved_horizontally && ! moved_vertically ) throw 'stuck';
    }
    return true;
}
```

---

<!-- _class: small -->

## Plans – Explanation and plan library

```javascript
planLibrary.push( GoPickUp )
planLibrary.push( BlindMove )
```

- `BlindMove` is the plan of Lab 3, now **stoppable** and able to **fail**
  - when neither move succeeds (wall, another agent) it throws `'stuck'`
  - the `go_to` sub-intention fails, so does `GoPickUp`, and the intention is dropped
- Extending the agent means **adding plans** to the library, for example:
  - a `go_to` plan using path finding (BFS/A*) tried before `BlindMove`
  - a `go_deliver` plan, with a matching option generated when carrying parcels

---

<!-- _class: small -->

## Running many agents – `multiple_run.js`

```javascript
const agentPath = fileURLToPath( new URL( './intention_revision.js', import.meta.url ) );

for ( let i = 0; i < 5; i++ ) {
    const name = 'm_'+i;
    const childProcess = spawn( process.execPath, [ agentPath ], {
        env: { ...process.env, TOKEN: '', NAME: name }
    } );
    childProcess.stdout.on('data', data => console.log(`Output from ${name}: ${data}`) );
}
```

- Spawns **5 agents** as child processes, each with an empty `TOKEN` and its own `NAME`, so the server creates a new identity per agent
- Useful to **benchmark** intention revision strategies when agents **compete** for the same parcels

---

<!-- _class: small -->

## Exercises

- Implement `IntentionRevisionRevise` with a utility function (reward − distance)
- Make option generation smarter: trigger it only when beliefs change
- Generalize the validity check in `loop()`: let each intention/plan tell whether it is still valid
- Add a `go_deliver` option and plan
- Replace `BlindMove` with a path finding `go_to` plan, keeping `BlindMove` as fallback
- Compare **Queue**, **Replace** and **Revise**

---

<!-- _class: lead -->

# Questions?

Code: [https://github.com/unitn-ASA/DeliverooAgent.js](https://github.com/unitn-ASA/DeliverooAgent.js)
Deliveroo.js: [https://github.com/unitn-ASA/Deliveroo.js](https://github.com/unitn-ASA/Deliveroo.js)
