/**
 * First-line blocklist for image prompts (sexual/explicit content).
 * Proven against 229 cases: near-zero false positives on innocent words
 * ("class", "title", "badass", "comic strip", "tennis balls") while
 * catching plurals, porn-site names, and CSAM-coded terms.
 * Misspellings and euphemisms are the /api/moderate classifier's job.
 */
export const NSFW_PROMPT_PATTERN =
  /\b(nudes?|nakeds?|nsfw|porn|pornographic|porn ?stars?|pornhub|xvideos|xhamster|xnxx|redtube|youporn|manyvids|clips4sale|spankbang|chaturbate|myfreecams|livejasmin|stripchat|bongacams|rule ?34|erotic|erotica|explicit|sexy|hentai|ecchi|oppai|ahegao|yiff|loli|lolicon|shota|shotacon|school ?girls?|jailbait|ageplay|non-?con|dub-?con|zoophil(?:e|ia)?|necrophil(?:e|iac?)|pedophil(?:e|iac?)|paedophil(?:e|iac?)|hebephil(?:e|ia)?|ephebophilia|child ?porn|kiddie ?porn|teen porn|barely legal|r-?18|adults only|gangbang|creampie|oral sex|anal|femdom|findom|cuckold|cuck|jizz|cum|fetish|bdsm|bondage|dominatrix|orgasm|masturbat(?:e|ion)?|ejaculat\w*|copulat\w*|coitus|foreplay|making love|incest|bestiality|rape|sodomy|intercourse|genital|pubic|upskirt|downblouse|creepshot|voyeur(?:ism)?|exhibitionis(?:t|m)|revenge porn|thirst trap|glory holes?|grope|groping|molest\w*|fondl\w*|lingerie|pant(?:y|ies)|thongs?|g-strings?|pasties|stripper|strip ?(?:poker|clubs?)|call ?girls?|cam ?girls?|brothel|red light district|boudoir|pin-?ups?|centerfold|onlyfans|playboy|playgirl|milf|dilf|gilf|boob(?:s|ies)?|tits?|titties|puss(?:y|ies)|dicks?|cocks?|penis(?:es)?|vaginas?|clits?|nipples?|areola|breasts?|cleavage|crotch(?:less)?|butts?|butt naked|arses?|asses|(?<![a-z])ass(?!et\b)|blowjob|handjob|foot ?fetish|foot ?jobs?|tit ?jobs?|rim ?jobs?|fisting|cumshot|bukkake|pegging|deepthroat|facesitting|threesome|foursome|swingers?|orgy|prostitut(?:e|ion)?|fap|fapping|wank|wanking|wanker|jerk ?off|jack ?off|doggy ?style|lap ?dance|peep ?shows?|adult (?:films?|videos?|movies?)|blue (?:movies?|films?)|sex ?(?:tapes?|dolls?|toys?)|phone ?sex|cybersex|sexting|sex shops?|adult (?:bookstore|shop|store)s?|lewd|horny|aroused|arousal|lustful|lusty|smut(?:ty)?|raunchy|topless|undressed|undressing|undress|disrobed|sheer|see ?through|no clothes|without clothes|body ?paint|bodypaint|birthday suit|wet (?:t-?shirts?|shirts?|dress|clothes|clothing)|dildo|vibrator|fleshlight|butt ?plugs?|kamasutra)\b/i;

export function isBlockedImagePrompt(prompt: string): boolean {
  return NSFW_PROMPT_PATTERN.test(prompt);
}
