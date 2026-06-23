-- Editorial blurbs for the top ~100 shows by popularity (original content layer;
-- AdSense quality insurance). Load: npm run blurbs:load:local / :remote
-- Renders on show hubs and /best-episodes pages. Review and rewrite freely.

UPDATE shows SET blurb = 'A mild-mannered chemistry teacher''s slide into the drug trade remains television''s gold standard for slow-burn transformation. The back half of Season 4 through Season 5''s "Ozymandias" is as close to flawless as TV gets.' WHERE slug = 'breaking-bad';

UPDATE shows SET blurb = 'HBO''s sprawling fantasy of feuding houses delivered spectacle television had never attempted — and the early seasons of political knife-work still hold up, whatever you think of the ending.' WHERE slug = 'game-of-thrones';

UPDATE shows SET blurb = 'What starts as a case-of-the-week procedural about a crime-predicting machine quietly becomes one of TV''s smartest dramas about artificial intelligence. Stick with it: Seasons 3 and 4 are the payoff.' WHERE slug = 'person-of-interest';

UPDATE shows SET blurb = 'The rare franchise spin-off that outgrew its source movie, balancing planet-of-the-week adventure with a decade of easy team chemistry. Comfort sci-fi at its most reliable.' WHERE slug = 'stargate-sg-1';

UPDATE shows SET blurb = 'The Pegasus-galaxy sibling of SG-1 trades mythology weight for breezier exploration and the franchise''s best ensemble banter.' WHERE slug = 'stargate-atlantis';

UPDATE shows SET blurb = 'An anthology that bottles the Coen brothers'' tone — polite Midwestern menace, terrible decisions, snow — and somehow earns the comparison. Each season stands alone; Season 2 is the high-water mark.' WHERE slug = 'fargo';

UPDATE shows SET blurb = 'Interdimensional sci-fi played as nihilist farce, dense enough with ideas that single episodes out-plot entire series. Its peak half-hours rank with the best TV comedy ever made.' WHERE slug = 'rick-and-morty';

UPDATE shows SET blurb = 'The X-Files'' weirder, warmer successor: fringe-science cases that bloom into a genuinely moving parallel-universe saga. Push through Season 1 — Seasons 2 and 3 soar.' WHERE slug = 'fringe';

UPDATE shows SET blurb = 'The template for two decades of genre television: two perfectly mismatched agents, a mythology that thrills before it sprawls, and standalone hours that still rank among TV''s best.' WHERE slug = 'the-x-files';

UPDATE shows SET blurb = 'High school as literal hell, monster-of-the-week as metaphor — Buffy invented the playbook modern genre TV still runs. Seasons 2, 3 and 5 are the essential arcs.' WHERE slug = 'buffy-the-vampire-slayer';

UPDATE shows SET blurb = 'The sitcom comfort-food benchmark: six friends, one coffee shop, and an episode-quality floor almost no comedy running this long has matched.' WHERE slug = 'friends';

UPDATE shows SET blurb = 'Standalone techno-parables ranging from devastating to merely clever — the anthology format means a ranked episode list IS the correct watch order.' WHERE slug = 'black-mirror';

UPDATE shows SET blurb = 'Two brothers, one Impala, fifteen seasons of monster hunting that mutates from roadside horror procedural into full cosmic mythology. The consensus golden age is Seasons 1–5.' WHERE slug = 'supernatural';

UPDATE shows SET blurb = 'Television''s fastest-turnaround satire, still skewering the news cycle within days after more than 25 years. Wildly uneven by design — which makes an episode ranking genuinely useful.' WHERE slug = 'south-park';

UPDATE shows SET blurb = 'The underrated modern Holmes: Jonny Lee Miller and Lucy Liu build a partnership procedural with more patience and character growth than its flashier rivals.' WHERE slug = 'elementary';

UPDATE shows SET blurb = 'The plane-crash mystery box that taught network TV to think in mythology, flashbacks and water-cooler cliffhangers. Divisive ending, untouchable peaks — "The Constant" alone justifies the ride.' WHERE slug = 'lost';

UPDATE shows SET blurb = 'Six decades of regenerating sci-fi means there is a Doctor for everyone; the revival''s Tennant and Smith eras remain the easiest on-ramp.' WHERE slug = 'doctor-who';

UPDATE shows SET blurb = 'An anthology of haunted detectives where each season lives or dies on its central pairing — and Season 1''s McConaughey–Harrelson descent remains the reference point.' WHERE slug = 'true-detective';

UPDATE shows SET blurb = 'A forensic procedural with a screwball heart: the case engine is standard issue, but the Booth-and-Brennan chemistry is why twelve seasons flew by.' WHERE slug = 'bones';

UPDATE shows SET blurb = 'James Spader having more fun than anyone else on network TV, working through a criminal hit-list one theatrical monologue at a time. Front-loaded: the early seasons are the strongest.' WHERE slug = 'the-blacklist';

UPDATE shows SET blurb = 'The BAU profiling engine ran for fifteen seasons because the formula works: one killer''s mind per week, anchored by one of TV''s most stable ensembles.' WHERE slug = 'criminal-minds';

UPDATE shows SET blurb = 'The longest-running scripted show in American TV history — and its 1990s golden age, roughly Seasons 3 through 8, is still the densest run of comedy ever animated.' WHERE slug = 'the-simpsons';

UPDATE shows SET blurb = 'Corporate law as a pure banter-delivery system: sharp suits, sharper dialogue, and a mentor–protégé dynamic that carried it to streaming megahit status years after it aired.' WHERE slug = 'suits';

UPDATE shows SET blurb = 'The grittiest corner of the One Chicago universe, trading the franchise''s case-of-the-week comfort for Voight''s morally flexible Intelligence Unit.' WHERE slug = 'chicago-pd';

UPDATE shows SET blurb = 'The flagship of the One Chicago franchise: firehouse-family drama with a procedural pulse, engineered for the long haul.' WHERE slug = 'chicago-fire';

-- ---- top 100 expansion (shows 26–100 + high-traffic modern titles) ----

UPDATE shows SET blurb = 'Hard sci-fi with real orbital mechanics and politics that actually matter — the Rocinante crew carries a show that rewards patience through its slow middle. Season 4 is the consensus peak; start there if you need proof.' WHERE slug = 'the-expanse';

UPDATE shows SET blurb = 'Marvel television finally grew up on Netflix: street-level noir, bone-cracking fights, and a hero who cannot stop punishing himself. Season 1 is the essential run; Season 3 is the masterpiece.' WHERE slug = 'marvels-daredevil';

UPDATE shows SET blurb = 'Steven Spielberg nostalgia as horror — small-town kids, government labs, and a Demogorgon in the woods. Season 1 is perfect comfort-spook; Season 4 splits the party but still delivers set-piece thrills.' WHERE slug = 'stranger-things';

UPDATE shows SET blurb = 'Tom Hardy growls through a grimy period revenge piece that feels more like a gothic novel than prestige TV. Short, strange, and entirely its own thing — finish it before you judge it.' WHERE slug = 'taboo-2017';

UPDATE shows SET blurb = 'A six-hour spy thriller that plays like a feature film with room to breathe — Tom Hiddleston''s hotel manager is all polished menace. One of the best limited runs of the 2010s.' WHERE slug = 'the-night-manager';

UPDATE shows SET blurb = 'Romance, time travel, and Scottish history braided into one of cable''s most devoted fandoms. Season 1''s wedding-to-Paris arc is the show at full power; later seasons lean soapier but the core couple still lands.' WHERE slug = 'outlander';

UPDATE shows SET blurb = 'The navy procedural that became American TV wallpaper — and still works because Gibbs''s team feels like family. The early seasons are leaner; the later ones are comfort viewing with explosions.' WHERE slug = 'ncis';

UPDATE shows SET blurb = 'The zombie apocalypse as a long-form survival epic, not a sprint. Season 1 is tight horror; the Governor arc is the show''s dramatic high-water mark before the later sprawl.' WHERE slug = 'the-walking-dead';

UPDATE shows SET blurb = 'Two decades of ripped-from-the-headlines cases anchored by one of TV''s most durable franchises. Stabler-and-Benson chemistry carried the early years; the revival seasons lean darker still.' WHERE slug = 'law-and-order-special-victims-unit';

UPDATE shows SET blurb = 'The weekly explainer that turned HBO late night into appointment viewing — dense journalism delivered as comedy. Pick any random episode from the Trump era onward and you get the format at full strength.' WHERE slug = 'last-week-tonight-with-john-oliver';

UPDATE shows SET blurb = 'The medical third leg of the One Chicago stool: emergency-room stakes with the same crossover DNA as Fire and P.D. Built for bingeing on a rainy weekend.' WHERE slug = 'chicago-med';

UPDATE shows SET blurb = 'Cozy British mystery with a vicar who solves crimes between sermons — Grantchester succeeds because the village matters as much as the case. Later seasons swap leads but keep the gentle rhythm.' WHERE slug = 'grantchester';

UPDATE shows SET blurb = 'The hospital soap that never stopped — twenty seasons of trauma, romance, and Meredith Grey surviving the impossible. The early seasons are sharper; the later ones are pure comfort for longtime viewers.' WHERE slug = 'greys-anatomy';

UPDATE shows SET blurb = 'The Arrowverse''s speedster anchor: breezy superheroics with a heart-on-sleeve cast. Season 1 is the tightest; the crossovers are the reward for sticking around.' WHERE slug = 'the-flash';

UPDATE shows SET blurb = 'The cutaway comedy that outlasted its critics and became a generational reference machine. The first dozen seasons still hit; the later ones are for completists and meme historians.' WHERE slug = 'family-guy';

UPDATE shows SET blurb = 'Seth MacFarlane''s other long-runner — CIA satire with surprisingly sweet family beats underneath the absurdity. Roger alone justifies putting it on in the background.' WHERE slug = 'american-dad';

UPDATE shows SET blurb = 'The show that launched a decade of DC television on the CW — brooding vigilante drama that learned to embrace its comic-book silliness. Season 2 is where it finds its swagger.' WHERE slug = 'arrow';

UPDATE shows SET blurb = 'Ten hours that still define the WWII miniseries — Band of Brothers earns every emotional beat through boots-on-the-ground detail. Watch it once; remember it forever.' WHERE slug = 'band-of-brothers';

UPDATE shows SET blurb = 'Fourteen episodes of perfect space-western that fans have been mourning for twenty years. If you only watch one cancelled sci-fi, make it this one — then skip the movie until you''re ready.' WHERE slug = 'firefly';

UPDATE shows SET blurb = 'Modern Holmes as a high-functioning sociopath and Watson as the audience surrogate — Steven Moffat and Mark Gatiss cracked the adaptation code. Series 1–2 are essential; Series 4 divides the room.' WHERE slug = 'sherlock';

UPDATE shows SET blurb = 'The series that proved TV could be cinema — mob family drama with therapy sessions and Sunday gravy. Season 1 is a slow burn that pays off in ways network TV never attempted.' WHERE slug = 'the-sopranos';

UPDATE shows SET blurb = 'The anthology that taught generations what a twist ending could be — Rod Serling''s moral parables still feel modern. Any season works; start with the iconic hours and follow your curiosity.' WHERE slug = 'the-twilight-zone';

UPDATE shows SET blurb = 'Kentucky neo-noir with Timothy Olyphant playing the coolest marshal on television. Every season delivers; the finale sticks the landing better than almost any long-runner.' WHERE slug = 'justified';

UPDATE shows SET blurb = 'Medical mystery as misanthropic superhero — Hugh Laurie carries a procedural that secretly cares about every patient. The first four seasons are the must-watch core.' WHERE slug = 'house';

UPDATE shows SET blurb = 'Space opera with something to say about faith, politics, and what survival costs. The miniseries is the on-ramp; the Ronald D. Moore series peaks in its middle seasons before the controversial finale.' WHERE slug = 'battlestar-galactica';

UPDATE shows SET blurb = 'The gold standard for thoughtful sci-fi on television — Picard''s Enterprise explores ideas before phasers. Season 3–6 is the show''s confident middle; "The Best of Both Worlds" is required viewing.' WHERE slug = 'star-trek-the-next-generation';

UPDATE shows SET blurb = 'Prison drama that rewired what HBO could do — brutal, literary, and unafraid of ensemble sprawl. Season 4 is the consensus masterpiece; the finale still starts arguments.' WHERE slug = 'oz';

UPDATE shows SET blurb = 'The anime epic that outlasted every skeptic — a pirate adventure that grows more ambitious the longer it sails. The consensus is to skip filler and commit to the long voyage; the payoff is real.' WHERE slug = 'one-piece';

UPDATE shows SET blurb = 'History as blood-soaked prestige drama — Travis Fimmel''s Ragnar Lothbrok makes pagan raiding feel like Shakespeare. Season 1–4 are the core saga before the time jumps.' WHERE slug = 'vikings';

UPDATE shows SET blurb = 'Pulp crime with Antony Starr doing unspeakable things in a small town — Banshee is the hidden gem your action-loving friend keeps recommending. Short, violent, and weirdly romantic.' WHERE slug = 'banshee';

UPDATE shows SET blurb = 'The political idealist''s fantasy and the best-written walk-and-talk in TV history. Aaron Sorkin''s first four seasons are the essential run; what follows is still worth your time if you love the staff.' WHERE slug = 'the-west-wing';

UPDATE shows SET blurb = 'The animated sci-fi sitcom that predicted the future and mocked it anyway. Seasons 1–4 are the classic era; the revival on Hulu found fresh gas in the tank.' WHERE slug = 'futurama';

UPDATE shows SET blurb = 'The Breaking Bad prequel that became its own tragedy — Jimmy McGill''s slide into Saul Goodman is patient, precise, and heartbreaking. Every season is essential; the finale is among the best ever made.' WHERE slug = 'better-call-saul';

UPDATE shows SET blurb = 'Chaos comedy about a family that refuses to stay sober — Shameless runs on Gallagher dysfunction and Emmy-level performances. The first five seasons are the sharpest; later years are for the devoted.' WHERE slug = 'shameless';

UPDATE shows SET blurb = 'Cold War spy craft as marriage counseling — Philip and Elizabeth Jennings lie to everyone, including each other. The final seasons are slow-burn perfection.' WHERE slug = 'the-americans';

UPDATE shows SET blurb = 'Brutalist period crime with Cillian Murphy''s flat cap and a razor-sharp soundtrack. Season 1–2 are the tightest; the later run expands the empire without losing its teeth.' WHERE slug = 'peaky-blinders';

UPDATE shows SET blurb = 'British police procedural as moral pressure cooker — AC-12 investigations feel like thrillers because the corruption is always personal. Series 3–6 are the ones people cannot stop recommending.' WHERE slug = 'line-of-duty';

UPDATE shows SET blurb = 'Teen noir that punched above its weight — Veronica Mars solved cases with wit sharp enough to cut. Season 1 is a perfect little mystery box; the movie and revival are for fans who never left Neptune.' WHERE slug = 'veronica-mars';

UPDATE shows SET blurb = 'The mockumentary that rewired workplace comedy — cringe, heart, and a finale that actually sticks the landing. Season 1–3 are the UK original; the US version has its own peaks after Jim and Pam''s will-they-won''t-they.' WHERE slug = 'the-office';

UPDATE shows SET blurb = 'Michael Connelly''s detective done right — Titus Welliver''s Bosch is quiet, stubborn, and always working a case in the margins. A perfect rainy-day procedural with real Los Angeles texture.' WHERE slug = 'bosch';

UPDATE shows SET blurb = 'Grimm fairy tales as police procedural — creature-of-the-week cases with a serialized mythology underneath. The early seasons balance both best; later years lean into the arc.' WHERE slug = 'grimm';

UPDATE shows SET blurb = 'The serial killer you were somehow rooting for — Dexter''s first four seasons are a masterclass in tension; what follows is increasingly divisive. "The Bay Harbor Butcher" through Trinity is the essential run.' WHERE slug = 'dexter';

UPDATE shows SET blurb = 'The space-station saga that proved sci-fi could be novelistic on a budget — Babylon 5 planned its story years ahead and mostly delivered. Season 2 onward is where the arc ignites.' WHERE slug = 'babylon-5';

UPDATE shows SET blurb = 'The franchise origin point — Kirk, Spock, and bold episodic sci-fi that still pops in its best hours. The Original Series is pick-and-choose; the movies reward the investment.' WHERE slug = 'star-trek';

UPDATE shows SET blurb = 'The darkest, richest corner of Star Trek — a space station war story with serialized storytelling years ahead of its time. Season 4–6 are the deep cut that converts skeptics.' WHERE slug = 'star-trek-deep-space-nine';

UPDATE shows SET blurb = 'Medical comedy with more heart than any drama — JD''s daydreams and Dr. Cox rants carry nine seasons of surprisingly emotional storytelling. Season 8''s finale was perfect; pretend the ninth doesn''t exist.' WHERE slug = 'scrubs';

UPDATE shows SET blurb = 'Idris Elba''s tortured detective versus London''s worst — Luther is prestige crime distilled to six episodes at a time. Every series delivers; Series 1 is the purest hit.' WHERE slug = 'luther';

UPDATE shows SET blurb = 'Sixty years of time travel before the revival — Hartnell through McCoy is vintage sci-fi comfort for the patient viewer. Pick a classic serial and see why the franchise endured.' WHERE slug = 'doctor-who-1963';

UPDATE shows SET blurb = 'The PBS science documentary that outclasses almost everything on television — Nova turns complex subjects into clear, beautiful hours. Any episode is a safe entry; follow whatever topic hooks you.' WHERE slug = 'nova';

UPDATE shows SET blurb = 'Royal pageantry as intimate character study — Claire Foy and Olivia Colman''s Elizabeth II anchors a series about duty versus self. Season 1–2 are the crown jewels; later casts keep the standard high.' WHERE slug = 'the-crown';

UPDATE shows SET blurb = 'Spy comedy that never forgot to be funny — Sterling Archer''s narcissism is the joke, and the supporting cast is the payoff. Season 1–4 are the golden run; the dream sequences later are divisive bonus material.' WHERE slug = 'archer';

UPDATE shows SET blurb = 'A sitcom too clever for its ratings — meta humor, paintball, and a found family at Greendale Community College. Season 2 is peak; the Yahoo season is better than its reputation.' WHERE slug = 'community';

UPDATE shows SET blurb = 'Modern Western noir with a sheriff who would rather be left alone — Longmire is comfort crime with Wyoming vistas. Steady, reliable, and perfect for one-more-episode nights.' WHERE slug = 'longmire';

UPDATE shows SET blurb = 'The sitcom about nothing that became everything — Seinfeld''s observational cruelty still lands decades later. Season 4–6 are the show firing on all cylinders.' WHERE slug = 'seinfeld';

UPDATE shows SET blurb = 'The Devil came to LA and found a crime procedural — Lucifer works because Tom Ellis commits fully to charm and cheese. Season 1–3 on Fox are the core; Netflix extended the party.' WHERE slug = 'lucifer';

UPDATE shows SET blurb = 'Hacker paranoia done as prestige drama — Mr. Robot looks like a thriller and reads like a dissertation on late capitalism. Season 1 is a perfect limited-feeling arc; Season 4 sticks the landing.' WHERE slug = 'mr-robot';

UPDATE shows SET blurb = 'Gothic horror mashup with Eva Green giving everything — Penny Dreadful is short, lush, and unafraid of melodrama. Three seasons, no filler, all atmosphere.' WHERE slug = 'penny-dreadful';

UPDATE shows SET blurb = 'Danish noir that Americanized beautifully — one season, one case, and a detective who cannot let go. The original and the AMC version each have defenders; both are worth the slow burn.' WHERE slug = 'the-killing';

UPDATE shows SET blurb = 'The Vampire Diaries spin-off that grew up — New Orleans witches and originals with real soap-opera stakes. The Mikaelson family drama is the reason to watch.' WHERE slug = 'the-originals';

UPDATE shows SET blurb = 'Romantic procedural comfort food — Richard Castle and Kate Beckett''s banter carries eight seasons of cases. The early seasons are the sweet spot before the mythology bloat.' WHERE slug = 'castle';

UPDATE shows SET blurb = 'Psychic detective as sunny procedural — Simon Baker''s Patrick Jane solves crimes by reading the room better than anyone. Front-loaded and breezy; great background brilliance.' WHERE slug = 'the-mentalist';

UPDATE shows SET blurb = 'Real-time thriller that invented binge-watching before streaming — Jack Bauer''s worst day ever, repeated for eight seasons. Season 1 and 5 are the peaks; the rest is for completists.' WHERE slug = '24';

UPDATE shows SET blurb = 'Prison break as pulp action — brotherly devotion, tattoo blueprints, and twists that refuse to stop twisting. Season 1 is a perfect mini-marathon; Season 2 is where opinions split.' WHERE slug = 'prison-break';

UPDATE shows SET blurb = 'The Star Trek prequel that struggled in the shadow of TNG — Enterprise finds its footing in Season 3''s Xindi arc and the Temporal Cold War. Worth the patience for Trek completists.' WHERE slug = 'star-trek-enterprise';

UPDATE shows SET blurb = 'British sci-fi about synths and humanity — quiet, melancholy, and smarter than its high-concept pitch suggests. Season 1 is the essential run; later seasons deepen the politics.' WHERE slug = 'humans';

UPDATE shows SET blurb = 'Theme-park sci-fi with a blockbuster budget — Westworld Season 1 is a puzzle box worth solving; what follows is increasingly ambitious and divisive. Start with the maze; argue about the rest later.' WHERE slug = 'westworld';

UPDATE shows SET blurb = 'Syfy space opera comfort food — crew dynamics and weekly adventure with lower stakes than The Expanse but higher charm. A perfect palate cleanser between heavier sci-fi.' WHERE slug = 'dark-matter';

UPDATE shows SET blurb = 'Viking-era England as historical action — Uhtred''s divided loyalties drive a series that gets better as the battles get bigger. Season 1–3 are the core; the later Netflix seasons reward staying.' WHERE slug = 'the-last-kingdom';

UPDATE shows SET blurb = 'Immortal medical examiner as cozy mystery — Joanne Froggatt and Ioan Gruffudd have easy chemistry in a show that deserved more seasons. One season, no cliffhanger hell — a complete pleasure.' WHERE slug = 'forever';

UPDATE shows SET blurb = 'The precinct comedy that actually got better — Brooklyn Nine-Nine balances goofball humor with surprisingly sharp social commentary. Season 2–5 are the sweet spot.' WHERE slug = 'brooklyn-nine-nine';

UPDATE shows SET blurb = 'Blue Bloods is Sunday-dinner cop drama — Reagan family meetings, case-of-the-week morality, and Tom Selleck''s gravitas. Built for multi-generational viewing on a lazy evening.' WHERE slug = 'blue-bloods';

UPDATE shows SET blurb = 'Legal thriller as chess match — Alicia Florrick''s reinvention after scandal is The Good Wife at its sharpest. Season 1–5 are essential; the finale is still debated and worth reaching.' WHERE slug = 'the-good-wife';

UPDATE shows SET blurb = 'The forensic procedural that launched a franchise empire — "Who are you?" and those Vegas neon autopsies defined a decade of TV. The original CSI''s first eight seasons are the template everything else copied.' WHERE slug = 'csi-crime-scene-investigation';

UPDATE shows SET blurb = 'Superman before Superman — Smallville took teenage Clark Kent seriously for ten seasons of earnest heartland heroism. The early seasons are the charm; later years lean full cape.' WHERE slug = 'smallville';

UPDATE shows SET blurb = 'Grim reaper dramedy with Mandy Patinkin''s dry wit — Dead Like Me is short, strange, and deeply 2000s in the best way. Two seasons and done; no commitment anxiety.' WHERE slug = 'dead-like-me';

-- ---- high-traffic modern titles (weight 95+, social + search landing pages) ----

UPDATE shows SET blurb = 'Game of Thrones returned as palace intrigue with dragons — House of the Dragon trades ice zombies for family civil war and somehow feels bloodier. Season 1''s succession crisis is the essential run; the ratings graph tells you which episodes landed hardest.' WHERE slug = 'house-of-the-dragon';

UPDATE shows SET blurb = 'Work-life balance taken literally — Severance turns corporate dystopia into a puzzle box you cannot stop picking at. Season 1''s finale is a cliffhanger that justifies every slow hallway shot that came before it.' WHERE slug = 'severance';

UPDATE shows SET blurb = 'Kitchen pressure cooker as character study — The Bear''s second season is the one people quote, but Season 1''s anxiety is the reason it broke through. An episode ranking here is basically a stress-level chart.' WHERE slug = 'the-bear';

UPDATE shows SET blurb = 'Succession is venomous comedy dressed as drama — the Roy family insults each other in boardrooms and yachts while the empire crumbles. Every season delivers; the finale is among the best hours television has produced.' WHERE slug = 'succession';

UPDATE shows SET blurb = 'Addams Family reimagined as Gen-Z gothic coming-of-age — Wednesday''s deadpan and dance numbers made it an instant meme factory. Season 1 is the full meal; the mystery wraps cleanly enough to binge in a weekend.' WHERE slug = 'wednesday';

UPDATE shows SET blurb = 'The video-game adaptation that finally worked — The Last of Us trusts silence, grief, and Pedro Pascal''s face more than exposition. Episode 3 alone justifies the whole project; the season-finale split is still argued about.' WHERE slug = 'the-last-of-us';

UPDATE shows SET blurb = 'Survival horror as character study — Yellowjackets splits crash-past and present until you cannot tell trauma from supernatural dread. Season 1 is the must-watch; the cliffhanger will make you angry in the best way.' WHERE slug = 'yellowjackets';

UPDATE shows SET blurb = 'Star Wars finally found its long-form voice — Andor is slow, political, and better for it. Season 1 builds to a heist hour that ranks with the best sci-fi television ever made.' WHERE slug = 'andor';

UPDATE shows SET blurb = 'Space western comfort food with Baby Yoda memes on top — The Mandalorian proved Star Wars could work as weekly adventure again. Season 1 is the tightest; later seasons expand the universe for fans who want more.' WHERE slug = 'the-mandalorian';

UPDATE shows SET blurb = 'Feel-good sports comedy that earned its tears — Ted Lasso''s kindness hit when the world needed it. Season 1 is perfect comfort; Season 2 complicates the formula; Season 3 is for the devoted.' WHERE slug = 'ted-lasso';

UPDATE shows SET blurb = 'Anthology luxury satire — each White Lotus season is a new resort, the same sharp class commentary, and a body count. Season 1 is tighter; Season 2 is funnier and meaner.' WHERE slug = 'the-white-lotus';

UPDATE shows SET blurb = 'James Clavell''s epic rebuilt for prestige TV — Shōgun treats translation, honor, and power with the patience of a novel. The limited run is the point; every hour earns its runtime.' WHERE slug = 'shogun';

UPDATE shows SET blurb = 'Fallout brings the wasteland''s black comedy to life with vault suits and moral gray zones — fans of the games will catch every easter egg; newcomers get a complete adventure. One season, big swing, worth the binge.' WHERE slug = 'fallout';

UPDATE shows SET blurb = 'Superhero violence as animated satire — Invincible starts like a Teen Titans riff and pivots into genuinely upsetting consequences. Season 1''s finale is the moment everyone texted their friends.' WHERE slug = 'invincible';

UPDATE shows SET blurb = 'The Boys is superhero deconstruction with a grin — corporate Vought, corrupt capes, and Karl Urban swearing at everyone. Season 1–3 are the essential run; each finale tries to out-shock the last.' WHERE slug = 'the-boys';

UPDATE shows SET blurb = 'Korean survival drama that became a global phenomenon — Squid Game''s games are colorful; the commentary is not. Season 1 is a complete statement; Season 2 exists for those who need closure on the cliffhanger.' WHERE slug = 'squid-game';

UPDATE shows SET blurb = 'Jack Reacher as walking problem solver — Amazon''s take leans into the books'' procedural rhythm with Alan Ritchson''s physical presence. Season 1 is the cleanest entry; later seasons deepen the supporting cast.' WHERE slug = 'reacher';

UPDATE shows SET blurb = 'British spy fiction with Gary Oldman''s flatulent genius at the center — Slow Horses makes bureaucracy funny and betrayal lethal. Any season works; start at the beginning and enjoy the insults.' WHERE slug = 'slow-horses';

