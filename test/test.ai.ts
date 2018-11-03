import {
    execute,
} from '../src/ai'
const assert = require('assert')

// Defines a Mocha test suite to group tests of similar kind together
describe("Extension Tests", () => {

    // Defines a Mocha unit test
    it("AI", () => {
        let out = execute('add function named gaga test')
        console.log('out:', out)
        assert.equal(out, 'How do I add function gagatest')
        // assert.equal(-1, [1, 2, 3].indexOf(5));
        // assert.equal(-1, [1, 2, 3].indexOf(0));
    });
});