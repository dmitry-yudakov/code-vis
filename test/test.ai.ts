import {
    execute,
    handleCode,
} from '../src/ai'
const assert = require('assert')

// Defines a Mocha test suite to group tests of similar kind together
describe("Extension Tests", () => {

    // Defines a Mocha unit test
    it("learn function", () => {
        let out = execute('add function named gaga test')
        console.log('out:', out)
        assert.equal(out, 'How do I add function gagatest')

        let out2 = handleCode(`function gagatest() {\n}`)
        assert.deepEqual(out2, {
            status: 'skill',
            name: 'add function',
            code: 'function __name__() {\n}',
        })

        assert.deepEqual(execute('add function named giga mega'), {
            actions: [
                'function gigamega() {\n}'
            ]
        })
    })
    it('learn var', () => {
        assert.deepEqual(execute('add variable named user'), 'How do I add variable user')
        assert.deepEqual(handleCode('let user\n'), {
            status: 'skill',
            name: 'add variable',
            code: 'let __name__\n',
        })
        assert.deepEqual(execute('add variable named gaga'), {
            actions: [
                'let gaga\n'
            ]
        })
    });
});