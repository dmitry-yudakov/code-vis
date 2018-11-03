const regexNamed = /(called|named)/

export const execute = (command: string) => {
    let tokens = command.split(/\s/).filter(i => i)
    let unknown = []
    let nameCollecting = null
    for (let tt of tokens) {
        if (regexNamed.test(tt)) {
            nameCollecting = []
        } else if (nameCollecting) {
            nameCollecting.push(tt)
        } else {
            unknown.push(tt)
        }
    }

    console.log(unknown, nameCollecting)
    if (unknown) {
        let resp = 'How do I ' + unknown.join(' ')
        if (nameCollecting) {
            resp += ' ' + nameCollecting.join('')
        }
        return resp
    }
    return tokens
}