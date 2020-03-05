import { glob } from 'glob';

export const getProjectFiles = (projectPath: string) => {
    const reIgnore = /(node_modules|\.js\.map$)/;

    return glob
        .sync(
            projectPath + '/**/*.{js,jsx,ts,tsx}'
            // { ignore: '**/node_modules/**' } <-- doesn't work
        )
        .filter(f => !reIgnore.test(f));
};
