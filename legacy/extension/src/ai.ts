const regexNamed = /^(called|named|name)/i;
const itIs = /^(it is|it's|that's|that is)/i;
const followedBy = /^(followed by)/i;
const beginsWith = /^(it begins with)/i;
const endsWith = /^(it ends with)/i;
const nevermind = /^(nevermind|never mind)/i;
const _this = /^this/i;

const NAME = '__name__';

let learningSkill = null;
let learningObject = null;
let lastName = null;

let skills = {};
let objects = {};

const tok2skill = (tokens) => tokens.join(' ');
const tok2name = (tokens) => tokens.join('');
const fillName = (skills, name) => {
  return skills.map((ss) => ss.replace(NAME, name));
};
const findSkill = (skillName) => {
  console.log('search for skill', skillName, skills);
  return skills[skillName];
};

export const execute = (command: string) => {
  let tokens = command.split(/\s/).filter((i) => i),
    unknown = [],
    nameCollecting = null,
    result = [];

  while (tokens.length) {
    let tt = tokens.shift();
    let remaining = tt + ' ' + tokens.join(' ');

    if (!tt) {
      // end of stream
    }

    if (false) {
      // } else if (beginsWith.test(remaining)) {
    } else if (regexNamed.test(tt)) {
      nameCollecting = [];
    } else if (nameCollecting) {
      nameCollecting.push(tt);
    } else {
      unknown.push(tt);
      const skill = findSkill(tok2skill(unknown));
      if (skill) {
        unknown = [];
        result.push(skill);
      }
    }
  }

  if (nameCollecting) {
    lastName = tok2name(nameCollecting);
  }

  console.log(unknown, nameCollecting);
  if (unknown.length) {
    learningSkill = tok2skill(unknown);
    let resp = `How do I ${learningSkill}`;
    if (nameCollecting) {
      // learningSkill = tok2skill([...unknown, NAME]) // ??
      resp += ` ${lastName}`;
    }

    return resp;
  }

  if (result.length) {
    if (lastName) result = fillName(result, lastName);
    return {
      actions: result,
    };
  }
  console.log('Return', tokens);
  return tokens; // ??
};

export const handleCode = (code) => {
  if (learningObject) {
    const objectName = learningObject;
    if (lastName) {
      code = code.replace(lastName, NAME);
    }
    objects[objectName] = code;
    learningObject = null;
    return {
      status: 'object',
      name: objectName,
      code,
    };
  }
  if (learningSkill) {
    const skillName = learningSkill;
    if (lastName) {
      code = code.replace(lastName, NAME);
    }
    skills[skillName] = code;
    learningSkill = null;
    return {
      status: 'skill',
      name: skillName,
      code,
    };
  }
  return null;
};
